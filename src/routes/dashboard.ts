import { Router, Request, Response } from 'express';
import { config } from '../config';
import {
  getDashboardStats, getCampaignBreakdown, getRecentActivity,
  getPageviewsByDay, getSubscribersByDay, getRevenueByDay, getCampaignPageviews
} from '../db/queries';
import { getRecentVideos, getChannelStats } from '../services/youtube';

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
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('[Dashboard] Stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/dashboard/campaigns
router.get('/campaigns', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const campaigns = await getCampaignBreakdown();
    res.json(campaigns);
  } catch (err) {
    console.error('[Dashboard] Campaigns error:', err);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

// GET /api/dashboard/activity
router.get('/activity', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const activity = await getRecentActivity();
    res.json(activity);
  } catch (err) {
    console.error('[Dashboard] Activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// GET /api/dashboard/pageviews
router.get('/pageviews', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = parseInt(req.query.days as string) || 30;
    const pageviews = await getPageviewsByDay(days);
    res.json(pageviews);
  } catch (err) {
    console.error('[Dashboard] Pageviews error:', err);
    res.status(500).json({ error: 'Failed to load pageviews' });
  }
});

// GET /api/dashboard/charts — time-series data for charts
router.get('/charts', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const days = parseInt(req.query.days as string) || 30;
    const [pageviews, subscribers, revenue] = await Promise.all([
      getPageviewsByDay(days),
      getSubscribersByDay(days),
      getRevenueByDay(days),
    ]);
    res.json({ pageviews, subscribers, revenue });
  } catch (err) {
    console.error('[Dashboard] Charts error:', err);
    res.status(500).json({ error: 'Failed to load charts' });
  }
});

// GET /api/dashboard/funnel — unified video-to-revenue attribution
router.get('/funnel', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  try {
    const [campaigns, campaignPageviews, ytData] = await Promise.all([
      getCampaignBreakdown(),
      getCampaignPageviews(),
      (config.youtube.apiKey && config.youtube.channelId)
        ? Promise.all([getChannelStats(), getRecentVideos(30)])
        : Promise.resolve([null, []] as const),
    ]);

    const [channel, videos] = ytData as [any, any[]];

    // Build pageview lookup by campaign
    const pvMap = new Map<string, number>();
    for (const pv of campaignPageviews) {
      pvMap.set(pv.campaign, pv.views);
    }

    // Enrich campaigns with pageviews
    const enrichedCampaigns = campaigns.map(c => ({
      ...c,
      pageviews: pvMap.get(c.campaign) || 0,
      revenuePerSub: c.subscribers > 0 ? +(c.revenue / c.subscribers).toFixed(2) : 0,
    }));

    res.json({
      channel,
      videos: videos || [],
      campaigns: enrichedCampaigns,
    });
  } catch (err) {
    console.error('[Dashboard] Funnel error:', err);
    res.status(500).json({ error: 'Failed to load funnel data' });
  }
});

// GET /api/dashboard/youtube
router.get('/youtube', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  if (!config.youtube.apiKey || !config.youtube.channelId) {
    res.json({ channel: null, videos: [], error: 'YouTube API not configured' });
    return;
  }
  try {
    const [channel, videos] = await Promise.all([
      getChannelStats(),
      getRecentVideos(20),
    ]);
    res.json({ channel, videos });
  } catch (err) {
    console.error('[Dashboard] YouTube error:', err);
    res.status(500).json({ error: 'Failed to load YouTube data' });
  }
});

export default router;
