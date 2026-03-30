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
CREATE TABLE IF NOT EXISTS pageviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    event_name TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    email TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    visitor_id TEXT,
    utm_source TEXT,
    utm_campaign TEXT,
    utm_medium TEXT,
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_session_id TEXT UNIQUE NOT NULL,
    utm_campaign TEXT,
    utm_source TEXT,
    purchased_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_created ON pageviews(created_at);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email);

CREATE TABLE IF NOT EXISTS campaign_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utm_campaign TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    description TEXT,
    spend_date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaign_costs_campaign ON campaign_costs(utm_campaign);

CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_charge_id TEXT UNIQUE NOT NULL,
    refunded_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_refunds_email ON refunds(email);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  const db = getDb();
  // Execute each statement separately (libsql doesn't support multi-statement exec)
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  initialized = true;
}
