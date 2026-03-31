import { createClient, type Client } from '@libsql/client';
import { config } from '../config';

let client: Client | null = null;
let initialized = false;

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: config.turso.url,
      authToken: config.turso.authToken,
    });
  }
  return client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    youtube_channel_id TEXT,
    youtube_api_key TEXT,
    mailerlite_api_key TEXT,
    mailerlite_group_id TEXT,
    stripe_product_ids TEXT,
    stripe_secret_key TEXT,
    stripe_webhook_secret TEXT,
    opt_in_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pageviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    page TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    utm_source TEXT,
    utm_campaign TEXT,
    utm_medium TEXT,
    referrer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    event_name TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    email TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    email TEXT NOT NULL,
    visitor_id TEXT,
    utm_source TEXT,
    utm_campaign TEXT,
    utm_medium TEXT,
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(channel_id, email)
);

CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    email TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_session_id TEXT UNIQUE NOT NULL,
    utm_campaign TEXT,
    utm_source TEXT,
    purchased_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    utm_campaign TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    description TEXT,
    spend_date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'default',
    email TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_charge_id TEXT UNIQUE NOT NULL,
    refunded_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_created ON pageviews(created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_channel ON pageviews(channel_id);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events(channel_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_channel ON subscribers(channel_id);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email);
CREATE INDEX IF NOT EXISTS idx_purchases_channel ON purchases(channel_id);
CREATE INDEX IF NOT EXISTS idx_campaign_costs_campaign ON campaign_costs(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_refunds_email ON refunds(email);
CREATE INDEX IF NOT EXISTS idx_purchases_email_source ON purchases(email_source);
`;

// Migration: add channel_id to existing tables that don't have it yet
const MIGRATIONS = [
  // Add channel_id column to existing tables. Use DEFAULT 'default' without NOT NULL for compat.
  `ALTER TABLE pageviews ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  `ALTER TABLE events ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  `ALTER TABLE subscribers ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  `ALTER TABLE purchases ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  `ALTER TABLE campaign_costs ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  `ALTER TABLE refunds ADD COLUMN channel_id TEXT DEFAULT 'default'`,
  // Email-level purchase attribution
  `ALTER TABLE pageviews ADD COLUMN email_source TEXT`,
  `ALTER TABLE purchases ADD COLUMN email_source TEXT`,
];

export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  const db = getDb();
  // Execute each statement separately (libsql doesn't support multi-statement exec)
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // Run migrations (silently ignore errors — columns may already exist)
  for (const migration of MIGRATIONS) {
    try { await db.execute(migration); console.log('[Schema] Migration OK:', migration.slice(0, 60)); } catch (e) { console.log('[Schema] Migration skipped (expected):', (e as Error).message?.slice(0, 80)); }
  }

  // Ensure default channel exists
  await db.execute({
    sql: `INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)`,
    args: ['default', 'Default Channel'],
  });

  // Backfill NULL channel_id values to 'default'
  const tables = ['pageviews', 'events', 'subscribers', 'purchases', 'campaign_costs', 'refunds'];
  for (const table of tables) {
    try { await db.execute(`UPDATE ${table} SET channel_id = 'default' WHERE channel_id IS NULL`); } catch (_) {}
  }

  initialized = true;
}
