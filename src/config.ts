// Note: getAllSettings is imported dynamically to avoid circular dependency
// (config.ts → queries.ts → connection.ts → config.ts)

// Static config from env vars (always available)
export const config = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,https://*.lovable.app').split(',').map(s => s.trim()),
  mailerlite: {
    apiKey: process.env.MAILERLITE_API_KEY || '',
    groupId: process.env.MAILERLITE_GROUP_ID || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    productIds: (process.env.STRIPE_PRODUCT_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
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

// Settings keys that can be configured from the dashboard
const SETTINGS_KEYS = [
  'MAILERLITE_API_KEY',
  'MAILERLITE_GROUP_ID',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRODUCT_IDS',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CHANNEL_ID',
  'DASHBOARD_SECRET',
  'OPT_IN_URL',
] as const;

// Reload config from DB settings (call on startup and after settings change)
let dbSettingsCache: Record<string, string> = {};
let lastLoaded = 0;

export async function reloadConfigFromDB(): Promise<void> {
  try {
    const { getAllSettings } = await import('./db/queries');
    dbSettingsCache = await getAllSettings();
    lastLoaded = Date.now();

    // Override config with DB values where they exist
    if (dbSettingsCache.MAILERLITE_API_KEY) config.mailerlite.apiKey = dbSettingsCache.MAILERLITE_API_KEY;
    if (dbSettingsCache.MAILERLITE_GROUP_ID) config.mailerlite.groupId = dbSettingsCache.MAILERLITE_GROUP_ID;
    if (dbSettingsCache.STRIPE_SECRET_KEY) config.stripe.secretKey = dbSettingsCache.STRIPE_SECRET_KEY;
    if (dbSettingsCache.STRIPE_WEBHOOK_SECRET) config.stripe.webhookSecret = dbSettingsCache.STRIPE_WEBHOOK_SECRET;
    if (dbSettingsCache.STRIPE_PRODUCT_IDS) config.stripe.productIds = dbSettingsCache.STRIPE_PRODUCT_IDS.split(',').map(s => s.trim()).filter(Boolean);
    if (dbSettingsCache.YOUTUBE_API_KEY) config.youtube.apiKey = dbSettingsCache.YOUTUBE_API_KEY;
    if (dbSettingsCache.YOUTUBE_CHANNEL_ID) config.youtube.channelId = dbSettingsCache.YOUTUBE_CHANNEL_ID;
    if (dbSettingsCache.DASHBOARD_SECRET) config.dashboardSecret = dbSettingsCache.DASHBOARD_SECRET;
  } catch (err) {
    console.warn('[Config] Failed to load settings from DB, using env vars:', err);
  }
}

// Mask sensitive values for display
export function maskValue(value: string): string {
  if (!value || value.length < 8) return '••••••••';
  return value.slice(0, 6) + '••••' + value.slice(-4);
}

// Get all configurable settings with masked values
export function getConfigForDisplay(): Array<{ key: string; value: string; masked: string; source: 'db' | 'env' | 'none' }> {
  return SETTINGS_KEYS.map(key => {
    const dbVal = dbSettingsCache[key];
    const envVal = getEnvForKey(key);
    const value = dbVal || envVal || '';
    const source = dbVal ? 'db' as const : envVal ? 'env' as const : 'none' as const;
    const isSensitive = key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN');
    return {
      key,
      value: isSensitive ? '' : value, // Never send sensitive values to frontend
      masked: value ? (isSensitive ? maskValue(value) : value) : '',
      source,
    };
  });
}

// Per-channel config resolution: channel-specific value → global config fallback
export interface ChannelConfig {
  mailerliteApiKey: string;
  mailerliteGroupId: string;
  youtubeApiKey: string;
  youtubeChannelId: string;
  stripeProductIds: string[];
}

const channelConfigCache = new Map<string, { data: ChannelConfig; expires: number }>();

export async function getChannelConfig(channelId?: string): Promise<ChannelConfig> {
  const id = channelId || 'default';

  // Default channel = global config
  if (id === 'default') {
    return {
      mailerliteApiKey: config.mailerlite.apiKey,
      mailerliteGroupId: config.mailerlite.groupId,
      youtubeApiKey: config.youtube.apiKey,
      youtubeChannelId: config.youtube.channelId,
      stripeProductIds: config.stripe.productIds,
    };
  }

  // Check cache (60s TTL)
  const cached = channelConfigCache.get(id);
  if (cached && Date.now() < cached.expires) return cached.data;

  // Load channel from DB
  try {
    const { getChannel } = await import('./db/queries');
    const ch = await getChannel(id);
    if (!ch) {
      // Channel not found, return global
      return getChannelConfig('default');
    }

    const cfg: ChannelConfig = {
      mailerliteApiKey: ch.mailerlite_api_key || config.mailerlite.apiKey,
      mailerliteGroupId: ch.mailerlite_group_id || config.mailerlite.groupId,
      youtubeApiKey: ch.youtube_api_key || config.youtube.apiKey,
      youtubeChannelId: ch.youtube_channel_id || config.youtube.channelId,
      stripeProductIds: ch.stripe_product_ids
        ? ch.stripe_product_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
        : config.stripe.productIds,
    };

    channelConfigCache.set(id, { data: cfg, expires: Date.now() + 60000 });
    return cfg;
  } catch (err) {
    console.warn(`[Config] Failed to load channel config for ${id}, using global:`, err);
    return getChannelConfig('default');
  }
}

function getEnvForKey(key: string): string {
  switch (key) {
    case 'MAILERLITE_API_KEY': return process.env.MAILERLITE_API_KEY || '';
    case 'MAILERLITE_GROUP_ID': return process.env.MAILERLITE_GROUP_ID || '';
    case 'STRIPE_SECRET_KEY': return process.env.STRIPE_SECRET_KEY || '';
    case 'STRIPE_WEBHOOK_SECRET': return process.env.STRIPE_WEBHOOK_SECRET || '';
    case 'STRIPE_PRODUCT_IDS': return process.env.STRIPE_PRODUCT_IDS || '';
    case 'YOUTUBE_API_KEY': return process.env.YOUTUBE_API_KEY || '';
    case 'YOUTUBE_CHANNEL_ID': return process.env.YOUTUBE_CHANNEL_ID || '';
    case 'DASHBOARD_SECRET': return process.env.DASHBOARD_SECRET || '';
    case 'OPT_IN_URL': return process.env.OPT_IN_URL || '';
    default: return '';
  }
}
