export const config = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,https://*.lovable.app').split(',').map(s => s.trim()),
  mailerlite: {
    apiKey: process.env.MAILERLITE_API_KEY || '',
    groupId: process.env.MAILERLITE_GROUP_ID || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  turso: {
    url: process.env.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    channelId: process.env.YOUTUBE_CHANNEL_ID || '',
  },
  dashboardSecret: process.env.DASHBOARD_SECRET || '',
};
