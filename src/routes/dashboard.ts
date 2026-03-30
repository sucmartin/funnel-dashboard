import { Router, Request, Response } from 'express';
import { config } from '../config';
import {
  getDashboardStats, getCampaignBreakdown, getRecentActivity,
  getPageviewsByDay, getSubscribersByDay, getRevenueByDay, getCampaignPageviews,
  addCampaignCost, getCampaignCosts, getCostEntries,
  getSubscriberScoring, getWeeklyStats, getDailySummary,
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

// GET /api/dashboard/stats
router.get('/stats', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : undefined;
    res.json(await getDashboardStats(days));
  }
  catch (err) { console.error('[Dashboard] Stats error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/today
router.get('/today', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getDailySummary()); }
  catch (err) { console.error('[Dashboard] Today error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/campaigns
router.get('/campaigns', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getCampaignBreakdown()); }
  catch (err) { console.error('[Dashboard] Campaigns error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/activity
router.get('/activity', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getRecentActivity()); }
  catch (err) { console.error('[Dashboard] Activity error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/pageviews
router.get('/pageviews', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getPageviewsByDay(parseInt(req.query.days as string) || 30)); }
  catch (err) { console.error('[Dashboard] Pageviews error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/charts
router.get('/charts', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = parseInt(req.query.days as string) || 30;
    const [pageviews, subscribers, revenue] = await Promise.all([
      getPageviewsByDay(days), getSubscribersByDay(days), getRevenueByDay(days),
    ]);
    res.json({ pageviews, subscribers, revenue });
  } catch (err) { console.error('[Dashboard] Charts error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/weekly
router.get('/weekly', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getWeeklyStats(parseInt(req.query.weeks as string) || 12)); }
  catch (err) { console.error('[Dashboard] Weekly error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/funnel — unified video-to-revenue attribution
router.get('/funnel', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const [campaigns, campaignPV, costs, scoring, ytData] = await Promise.all([
      getCampaignBreakdown(),
      getCampaignPageviews(),
      getCampaignCosts(),
      getSubscriberScoring(),
      (config.youtube.apiKey && config.youtube.channelId)
        ? Promise.all([getChannelStats(), getRecentVideos(30)])
        : Promise.resolve([null, []] as const),
    ]);

    const [channel, videos] = ytData as [any, any[]];
    const pvMap = new Map(campaignPV.map(p => [p.campaign, p.views]));
    const costMap = new Map(costs.map(c => [c.campaign, c.totalSpend]));
    const scoreMap = new Map(scoring.map(s => [s.campaign + '|' + s.source, s]));

    const enriched = campaigns.map(c => {
      const pageviews = pvMap.get(c.campaign) || 0;
      const spend = costMap.get(c.campaign) || 0;
      const score = scoreMap.get(c.campaign + '|' + c.source);
      return {
        ...c,
        pageviews,
        spend,
        roi: spend > 0 ? +((c.revenue - spend) / spend * 100).toFixed(0) : null,
        revenuePerSub: c.subscribers > 0 ? +(c.revenue / c.subscribers).toFixed(2) : 0,
        grade: score?.grade || 'D',
      };
    });

    res.json({ channel, videos: videos || [], campaigns: enriched });
  } catch (err) { console.error('[Dashboard] Funnel error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/youtube — enriched with funnel data per video
router.get('/youtube', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  if (!config.youtube.apiKey || !config.youtube.channelId) {
    res.json({ channel: null, videos: [] });
    return;
  }
  try {
    const [channel, videos, campaigns, campaignPV] = await Promise.all([
      getChannelStats(),
      getAllVideos(500),
      getCampaignBreakdown(),
      getCampaignPageviews(),
    ]);

    // Build lookup maps from campaign data
    const campMap = new Map(campaigns.map(c => [c.campaign, c]));
    const pvMap = new Map(campaignPV.map(p => [p.campaign, p.views]));

    // Slugify a video title the same way the UTM generator does
    function slugify(title: string): string {
      return title.toLowerCase()
        .replace(/['']/g, '')
        .replace(/neville goddard['s]?\s*/gi, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .split('-').slice(0, 8).join('-');
    }

    // Try to match each video to a campaign by fuzzy slug matching
    const enrichedVideos = videos.map((v: any) => {
      const slug = slugify(v.title);

      // Try exact match first, then partial matches
      let matchedCampaign = campMap.get(slug);
      let matchedSlug = slug;

      if (!matchedCampaign) {
        // Try matching by checking if any campaign slug is contained in the video slug or vice versa
        for (const [campSlug, camp] of campMap.entries()) {
          if (campSlug === 'direct') continue;
          // Check if significant overlap (at least 3 words match)
          const campWords = campSlug.split('-');
          const slugWords = slug.split('-');
          const overlap = campWords.filter((w: string) => w.length > 2 && slugWords.includes(w)).length;
          if (overlap >= 3 || campSlug.includes(slug.slice(0, 20)) || slug.includes(campSlug.slice(0, 20))) {
            matchedCampaign = camp;
            matchedSlug = campSlug;
            break;
          }
        }
      }

      const clicks = pvMap.get(matchedSlug) || 0;

      return {
        ...v,
        funnel: matchedCampaign ? {
          campaign: matchedCampaign.campaign,
          clicks,
          subscribers: matchedCampaign.subscribers,
          buyers: matchedCampaign.buyers,
          revenue: matchedCampaign.revenue,
          optinRate: clicks > 0 ? +((matchedCampaign.subscribers / clicks) * 100).toFixed(1) : 0,
        } : {
          campaign: null,
          clicks,
          subscribers: 0,
          buyers: 0,
          revenue: 0,
          optinRate: 0,
        },
      };
    });

    res.json({ channel, videos: enrichedVideos });
  } catch (err) { console.error('[Dashboard] YouTube error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/emails — MailerLite email performance
router.get('/emails', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const [campaigns, group] = await Promise.all([
      getEmailCampaigns(20).catch(() => []),
      getGroupStats().catch(() => null),
    ]);
    res.json({ campaigns, group });
  } catch (err) { console.error('[Dashboard] Emails error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/scoring — subscriber quality scores
router.get('/scoring', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getSubscriberScoring()); }
  catch (err) { console.error('[Dashboard] Scoring error:', err); res.status(500).json({ error: 'Failed' }); }
});

// POST /api/dashboard/costs — add a cost entry
router.post('/costs', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const { campaign, amount, description, date } = req.body;
    if (!campaign || !amount) { res.status(400).json({ error: 'campaign and amount required' }); return; }
    await addCampaignCost({
      utm_campaign: campaign,
      amount_cents: Math.round(parseFloat(amount) * 100),
      description,
      spend_date: date,
    });
    res.json({ ok: true });
  } catch (err) { console.error('[Dashboard] Cost add error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/costs
router.get('/costs', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getCostEntries(req.query.campaign as string)); }
  catch (err) { console.error('[Dashboard] Costs error:', err); res.status(500).json({ error: 'Failed' }); }
});

// GET /api/dashboard/summary — daily summary (for cron/notifications)
router.get('/summary', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try { res.json(await getDailySummary()); }
  catch (err) { console.error('[Dashboard] Summary error:', err); res.status(500).json({ error: 'Failed' }); }
});

export default router;
