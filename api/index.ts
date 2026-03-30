import express from 'express';
import cors from 'cors';
import { config, reloadConfigFromDB } from '../src/config';
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

// Load DB settings on first request (serverless-friendly)
let configLoaded = false;
app.use(async (_req, _res, next) => {
  if (!configLoaded) {
    try { await reloadConfigFromDB(); configLoaded = true; } catch (e) { console.error('[Init] Config load failed:', e); configLoaded = true; /* proceed with env vars */ }
  }
  next();
});

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

// For local dev
if (process.env.NODE_ENV !== 'production') {
  const port = parseInt(process.env.PORT || '4891', 10);
  app.listen(port, () => {
    console.log(`[Server] Running on http://localhost:${port}`);
  });
}

export default app;
