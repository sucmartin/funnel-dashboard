import express from 'express';
import cors from 'cors';
import { config } from '../src/config';
import trackRouter from '../src/routes/track';
import webhookRouter from '../src/routes/webhook';
import dashboardRouter from '../src/routes/dashboard';

const app = express();

// CORS — allow Lovable pages and local dev
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = config.allowedOrigins.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(origin);
      }
      return origin === pattern;
    });
    callback(null, allowed);
  },
  credentials: true,
}));

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use('/api/track', trackRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/dashboard', dashboardRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// For local dev
if (process.env.NODE_ENV !== 'production') {
  const port = parseInt(process.env.PORT || '4891', 10);
  app.listen(port, () => {
    console.log(`[Server] Running on http://localhost:${port}`);
  });
}

export default app;
