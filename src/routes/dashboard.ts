import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getDashboardStats, getCampaignBreakdown, getRecentActivity, getPageviewsByDay } from '../db/queries';
import { getRecentVideos, getChannelStats } from '../services/youtube';

const router = Router();

// Simple auth: check ?secret= query param
function checkAuth(req: Request, res: Response): boolean {
  if (!config.dashboardSecret) return true; // no secret = no auth required
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
