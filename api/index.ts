import express from 'express';
import cors from 'cors';
import { config } from '../src/config';
import trackRouter from '../src/routes/track';
import webhookRouter from '../src/routes/webhook';
import dashboardRouter from '../src/routes/dashboard';
import { TRACKING_SCRIPT } from '../src/tracking-script';

const app = express();

// CORS — allow all origins for tracking endpoints (same as Google Analytics)
app.use(cors());

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use('/api/track', trackRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/dashboard', dashboardRouter);

// Serve tracking script via API (bypasses CDN cache issues)
app.get('/tracking.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(TRACKING_SCRIPT);
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Daily summary cron (called by Vercel Cron at 8am UTC)
app.get('/api/cron/daily-summary', async (_req, res) => {
  try {
    const { getDailySummary } = await import('../src/db/queries');
    const summary = await getDailySummary();
    console.log(`[Cron] Daily summary: ${summary.pageviews} pageviews, ${summary.subscribers} subs, ${summary.purchases} purchases, $${summary.revenue} revenue`);
    // Could send email/Slack notification here in the future
    res.json({ ok: true, summary });
  } catch (err) {
    console.error('[Cron] Daily summary error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// Temporary: reset all data (remove after use)
app.post('/api/admin/reset', async (req, res) => {
  const secret = req.query.secret as string;
  if (secret !== (process.env.DASHBOARD_SECRET || '')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { getDb, ensureSchema } = await import('../src/db/connection');
    await ensureSchema();
    const db = getDb();
    await db.execute('DELETE FROM pageviews');
    await db.execute('DELETE FROM events');
    await db.execute('DELETE FROM subscribers');
    await db.execute('DELETE FROM purchases');
    await db.execute('DELETE FROM campaign_costs');
    res.json({ ok: true, message: 'All data cleared' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// For local dev
if (process.env.NODE_ENV !== 'production') {
  const port = parseInt(process.env.PORT || '4891', 10);
  app.listen(port, () => {
    console.log(`[Server] Running on http://localhost:${port}`);
  });
}

export default app;
