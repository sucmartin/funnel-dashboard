import { Router, Request, Response } from 'express';
import { config, getConfigForDisplay, reloadConfigFromDB } from '../config';
import {
  getDashboardStats, getCampaignBreakdown, getRecentActivity,
  getPageviewsByDay, getSubscribersByDay, getRevenueByDay, getCampaignPageviews,
  addCampaignCost, getCampaignCosts, getCostEntries,
  getSubscriberScoring, getWeeklyStats, getDailySummary,
  getVSLStats, getCheckoutStats, getFunnelFlow,
  setSetting, getChannels, getChannel, upsertChannel, deleteChannel,
} from '../db/queries';
import { getRecentVideos, getChannelStats, getAllVideos } from '../services/youtube';
import { getEmailCampaigns, getGroupStats } from '../services/mailerlite-stats';

const router = Router();

function checkAuth(req: Request, res: Response): boolean {
  if (!config.dashboardSecret) return true;
  const secret = req.query.secret as string;
  if (secret !== config.dashboardSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Extract channel_id from query param, default to 'default'
function ch(req: Request): string {
  return (req.query.channel as string) || 'default';
}

// ---- Channel CRUD ----

router.get('/channels', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getChannels()); }
  catch (err) { console.error('[Dashboard] Channels error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/channels/:id', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getChannel(req.params.id as string)); }
  catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/channels', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const { id, name, ...rest } = req.body;
    if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
    await upsertChannel({ id, name, ...rest });
    res.json({ ok: true });
  } catch (err) { console.error('[Dashboard] Channel save error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.delete('/channels/:id', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    await deleteChannel(req.params.id as string);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Dashboard data endpoints (all accept ?channel=xxx) ----

router.get('/stats', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : undefined;
    res.json(await getDashboardStats(days, ch(req)));
  } catch (err) { console.error('[Dashboard] Stats error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/today', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getDailySummary(ch(req))); }
  catch (err) { console.error('[Dashboard] Today error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/campaigns', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getCampaignBreakdown(ch(req))); }
  catch (err) { console.error('[Dashboard] Campaigns error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/activity', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getRecentActivity(20, ch(req))); }
  catch (err) { console.error('[Dashboard] Activity error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/pageviews', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getPageviewsByDay(parseInt(req.query.days as string) || 30, ch(req))); }
  catch (err) { console.error('[Dashboard] Pageviews error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/charts', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = parseInt(req.query.days as string) || 30;
    const c = ch(req);
    const [pageviews, subscribers, revenue] = await Promise.all([
      getPageviewsByDay(days, c), getSubscribersByDay(days, c), getRevenueByDay(days, c),
    ]);
    res.json({ pageviews, subscribers, revenue });
  } catch (err) { console.error('[Dashboard] Charts error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/weekly', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getWeeklyStats(parseInt(req.query.weeks as string) || 12, ch(req))); }
  catch (err) { console.error('[Dashboard] Weekly error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/funnel — unified video-to-revenue attribution
router.get('/funnel', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const c = ch(req);
    const [campaigns, campaignPV, costs, scoring] = await Promise.all([
      getCampaignBreakdown(c), getCampaignPageviews(c), getCampaignCosts(c), getSubscriberScoring(c),
    ]);

    let channel = null, videos: any[] = [];
    try {
      if (config.youtube.apiKey && config.youtube.channelId) {
        [channel, videos] = await Promise.all([getChannelStats(), getRecentVideos(30)]);
      }
    } catch (ytErr) { console.warn('[Dashboard] YouTube fetch failed in funnel, skipping:', ytErr); }

    const pvMap = new Map(campaignPV.map(p => [p.campaign, p.views]));
    const costMap = new Map(costs.map(c => [c.campaign, c.totalSpend]));
    const scoreMap = new Map(scoring.map(s => [s.campaign + '|' + s.source, s]));

    const enriched = campaigns.map(c => {
      const pageviews = pvMap.get(c.campaign) || 0;
      const spend = costMap.get(c.campaign) || 0;
      const score = scoreMap.get(c.campaign + '|' + c.source);
      return { ...c, pageviews, spend, roi: spend > 0 ? +((c.revenue - spend) / spend * 100).toFixed(0) : null, revenuePerSub: c.subscribers > 0 ? +(c.revenue / c.subscribers).toFixed(2) : 0, grade: score?.grade || 'D' };
    });

    res.json({ channel, videos: videos || [], campaigns: enriched });
  } catch (err) { console.error('[Dashboard] Funnel error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/youtube — enriched with funnel data per video
router.get('/youtube', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  if (!config.youtube.apiKey || !config.youtube.channelId) { res.json({ channel: null, videos: [] }); return; }
  try {
    const c = ch(req);
    const [channel, videos, campaigns, campaignPV] = await Promise.all([
      getChannelStats(), getAllVideos(500), getCampaignBreakdown(c), getCampaignPageviews(c),
    ]);

    const campMap = new Map(campaigns.map(c => [c.campaign, c]));
    const pvMap = new Map(campaignPV.map(p => [p.campaign, p.views]));

    function slugify(title: string): string {
      return title.toLowerCase().replace(/['']/g, '').replace(/neville goddard['s]?\s*/gi, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 8).join('-');
    }

    const enrichedVideos = videos.map((v: any) => {
      const slug = slugify(v.title);
      let matchedCampaign = campMap.get(slug);
      let matchedSlug = slug;

      if (!matchedCampaign) {
        for (const [campSlug, camp] of campMap.entries()) {
          if (campSlug === 'direct') continue;
          const campWords = campSlug.split('-');
          const slugWords = slug.split('-');
          const overlap = campWords.filter((w: string) => w.length > 2 && slugWords.includes(w)).length;
          if (overlap >= 3 || campSlug.includes(slug.slice(0, 20)) || slug.includes(campSlug.slice(0, 20))) {
            matchedCampaign = camp; matchedSlug = campSlug; break;
          }
        }
      }

      const clicks = pvMap.get(matchedSlug) || 0;
      return {
        ...v,
        funnel: matchedCampaign ? { campaign: matchedCampaign.campaign, clicks, subscribers: matchedCampaign.subscribers, buyers: matchedCampaign.buyers, revenue: matchedCampaign.revenue, optinRate: clicks > 0 ? +((matchedCampaign.subscribers / clicks) * 100).toFixed(1) : 0 } : { campaign: null, clicks, subscribers: 0, buyers: 0, revenue: 0, optinRate: 0 },
      };
    });

    res.json({ channel, videos: enrichedVideos });
  } catch (err) { console.error('[Dashboard] YouTube error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/emails
router.get('/emails', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const [campaigns, group] = await Promise.all([getEmailCampaigns(20).catch(() => []), getGroupStats().catch(() => null)]);
    res.json({ campaigns, group });
  } catch (err) { console.error('[Dashboard] Emails error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/scoring', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getSubscriberScoring(ch(req))); }
  catch (err) { console.error('[Dashboard] Scoring error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.post('/costs', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const { campaign, amount, description, date } = req.body;
    if (!campaign || !amount) { res.status(400).json({ error: 'campaign and amount required' }); return; }
    await addCampaignCost({ utm_campaign: campaign, amount_cents: Math.round(parseFloat(amount) * 100), description, spend_date: date, channel_id: ch(req) });
    res.json({ ok: true });
  } catch (err) { console.error('[Dashboard] Cost add error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/costs', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getCostEntries(req.query.campaign as string, ch(req))); }
  catch (err) { console.error('[Dashboard] Costs error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/summary', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getDailySummary(ch(req))); }
  catch (err) { console.error('[Dashboard] Summary error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/vsl-stats', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getVSLStats(req.query.days ? parseInt(req.query.days as string) : undefined, ch(req))); }
  catch (err) { console.error('[Dashboard] VSL stats error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/checkout-stats', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getCheckoutStats(req.query.days ? parseInt(req.query.days as string) : undefined, ch(req))); }
  catch (err) { console.error('[Dashboard] Checkout stats error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/funnel-flow', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getFunnelFlow(req.query.days ? parseInt(req.query.days as string) : undefined, ch(req))); }
  catch (err) { console.error('[Dashboard] Funnel flow error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.get('/settings', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { await reloadConfigFromDB(); res.json(getConfigForDisplay()); }
  catch (err) { console.error('[Dashboard] Settings error:', err); res.status(500).json({ error: 'Failed' }); }
});

router.put('/settings', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const { key, value } = req.body;
    if (!key) { res.status(400).json({ error: 'key required' }); return; }
    await setSetting(key, value || '');
    await reloadConfigFromDB();
    res.json({ ok: true });
  } catch (err) { console.error('[Dashboard] Settings update error:', err); res.status(500).json({ error: 'Failed' }); }
});

export default router;
