import { getDb, ensureSchema } from './connection';

// Default channel for backwards compatibility
const DC = 'default';

// ---- Channel management ----

export async function getChannels() {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute(`SELECT * FROM channels ORDER BY created_at ASC`);
  return result.rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    youtube_channel_id: row.youtube_channel_id as string | null,
    youtube_api_key: row.youtube_api_key as string | null,
    mailerlite_api_key: row.mailerlite_api_key as string | null,
    mailerlite_group_id: row.mailerlite_group_id as string | null,
    stripe_product_ids: row.stripe_product_ids as string | null,
    stripe_secret_key: row.stripe_secret_key as string | null,
    stripe_webhook_secret: row.stripe_webhook_secret as string | null,
    opt_in_url: row.opt_in_url as string | null,
    created_at: row.created_at as string,
  }));
}

export async function getChannel(id: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT * FROM channels WHERE id = ?`, args: [id] });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    youtube_channel_id: row.youtube_channel_id as string | null,
    youtube_api_key: row.youtube_api_key as string | null,
    mailerlite_api_key: row.mailerlite_api_key as string | null,
    mailerlite_group_id: row.mailerlite_group_id as string | null,
    stripe_product_ids: row.stripe_product_ids as string | null,
    stripe_secret_key: row.stripe_secret_key as string | null,
    stripe_webhook_secret: row.stripe_webhook_secret as string | null,
    opt_in_url: row.opt_in_url as string | null,
  };
}

export async function upsertChannel(data: {
  id: string; name: string;
  youtube_channel_id?: string; youtube_api_key?: string;
  mailerlite_api_key?: string; mailerlite_group_id?: string;
  stripe_product_ids?: string; stripe_secret_key?: string; stripe_webhook_secret?: string;
  opt_in_url?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO channels (id, name, youtube_channel_id, youtube_api_key, mailerlite_api_key, mailerlite_group_id, stripe_product_ids, stripe_secret_key, stripe_webhook_secret, opt_in_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, youtube_channel_id=excluded.youtube_channel_id, youtube_api_key=excluded.youtube_api_key,
            mailerlite_api_key=excluded.mailerlite_api_key, mailerlite_group_id=excluded.mailerlite_group_id,
            stripe_product_ids=excluded.stripe_product_ids, stripe_secret_key=excluded.stripe_secret_key,
            stripe_webhook_secret=excluded.stripe_webhook_secret, opt_in_url=excluded.opt_in_url`,
    args: [data.id, data.name, data.youtube_channel_id||null, data.youtube_api_key||null,
           data.mailerlite_api_key||null, data.mailerlite_group_id||null,
           data.stripe_product_ids||null, data.stripe_secret_key||null, data.stripe_webhook_secret||null,
           data.opt_in_url||null],
  });
}

export async function deleteChannel(id: string) {
  await ensureSchema();
  const db = getDb();
  if (id === 'default') throw new Error('Cannot delete default channel');
  await db.execute({ sql: `DELETE FROM channels WHERE id = ?`, args: [id] });
}

// ---- Write operations (tracking) ----

export async function insertPageview(data: {
  page: string; visitor_id: string;
  utm_source?: string; utm_campaign?: string; utm_medium?: string; referrer?: string;
  channel_id?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO pageviews (channel_id, page, visitor_id, utm_source, utm_campaign, utm_medium, referrer) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [data.channel_id || DC, data.page, data.visitor_id, data.utm_source||null, data.utm_campaign||null, data.utm_medium||null, data.referrer||null],
  });
}

export async function insertEvent(data: {
  event_name: string; visitor_id: string; email?: string; metadata?: string; channel_id?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO events (channel_id, event_name, visitor_id, email, metadata) VALUES (?, ?, ?, ?, ?)`,
    args: [data.channel_id || DC, data.event_name, data.visitor_id, data.email||null, data.metadata||null],
  });
}

export async function upsertSubscriber(data: {
  email: string; visitor_id: string;
  utm_source?: string; utm_campaign?: string; utm_medium?: string; channel_id?: string;
}) {
  await ensureSchema();
  const db = getDb();
  const ch = data.channel_id || DC;
  // Use ON CONFLICT(email) for compatibility with old schema (UNIQUE on email only)
  await db.execute({
    sql: `INSERT INTO subscribers (channel_id, email, visitor_id, utm_source, utm_campaign, utm_medium)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            visitor_id = excluded.visitor_id,
            channel_id = excluded.channel_id,
            utm_source = COALESCE(excluded.utm_source, subscribers.utm_source),
            utm_campaign = COALESCE(excluded.utm_campaign, subscribers.utm_campaign),
            utm_medium = COALESCE(excluded.utm_medium, subscribers.utm_medium)`,
    args: [ch, data.email, data.visitor_id, data.utm_source||null, data.utm_campaign||null, data.utm_medium||null],
  });
}

export async function getLatestPageviewUtms(visitor_id: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT utm_source, utm_campaign, utm_medium FROM pageviews WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [visitor_id],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return { utm_source: row.utm_source as string|null, utm_campaign: row.utm_campaign as string|null, utm_medium: row.utm_medium as string|null };
}

export async function insertPurchase(data: {
  email: string; amount_cents: number; currency: string; stripe_session_id: string;
  utm_campaign?: string; utm_source?: string; purchased_at: string; channel_id?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO purchases (channel_id, email, amount_cents, currency, stripe_session_id, utm_campaign, utm_source, purchased_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.channel_id||DC, data.email, data.amount_cents, data.currency, data.stripe_session_id, data.utm_campaign||null, data.utm_source||null, data.purchased_at],
  });
}

export async function getSubscriberByEmail(email: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT * FROM subscribers WHERE email = ? LIMIT 1`, args: [email] });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return { email: row.email as string, utm_source: row.utm_source as string|null, utm_campaign: row.utm_campaign as string|null, channel_id: row.channel_id as string };
}

export async function insertRefund(data: {
  email: string; amount_cents: number; currency: string; stripe_charge_id: string; refunded_at: string; channel_id?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO refunds (channel_id, email, amount_cents, currency, stripe_charge_id, refunded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [data.channel_id||DC, data.email, data.amount_cents, data.currency, data.stripe_charge_id, data.refunded_at],
  });
}

// ---- Dashboard queries (all filtered by channel_id) ----

export async function getDashboardStats(days?: number, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const dw = days ? `AND created_at >= datetime('now', '-${days} days')` : '';
  const ds = days ? `AND subscribed_at >= datetime('now', '-${days} days')` : '';
  const dp = days ? `AND purchased_at >= datetime('now', '-${days} days')` : '';

  const [pageviews, subscribers, purchases, events] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as count FROM pageviews WHERE COALESCE(channel_id, 'default') = ? ${dw}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as count FROM subscribers WHERE COALESCE(channel_id, 'default') = ? ${ds}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as revenue FROM purchases WHERE COALESCE(channel_id, 'default') = ? ${dp}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as count FROM events WHERE COALESCE(channel_id, 'default') = ? ${dw}`, args: [ch] }),
  ]);

  return {
    totalPageviews: Number(pageviews.rows[0].count),
    totalSubscribers: Number(subscribers.rows[0].count),
    totalPurchases: Number(purchases.rows[0].count),
    totalRevenue: Number(purchases.rows[0].revenue) / 100,
    totalEvents: Number(events.rows[0].count),
  };
}

export async function getCampaignBreakdown(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT campaign, source, MAX(views) as views, MAX(subscribers) as subscribers, MAX(buyers) as buyers, MAX(revenue_cents) as revenue_cents
    FROM (
      SELECT COALESCE(s.utm_campaign, 'direct') as campaign, COALESCE(s.utm_source, 'unknown') as source,
        0 as views, COUNT(DISTINCT s.email) as subscribers, COUNT(DISTINCT p.email) as buyers, COALESCE(SUM(p.amount_cents), 0) as revenue_cents
      FROM subscribers s LEFT JOIN purchases p ON s.email = p.email AND COALESCE(p.channel_id, 'default') = ?
      WHERE COALESCE(s.channel_id, 'default') = ? GROUP BY s.utm_campaign, s.utm_source
      UNION ALL
      SELECT COALESCE(utm_campaign, 'direct') as campaign, COALESCE(utm_source, 'unknown') as source,
        COUNT(*) as views, 0 as subscribers, 0 as buyers, 0 as revenue_cents
      FROM pageviews WHERE COALESCE(channel_id, 'default') = ? GROUP BY utm_campaign, utm_source
    ) GROUP BY campaign, source ORDER BY views DESC, subscribers DESC`,
    args: [ch, ch, ch],
  });
  return result.rows.map(row => ({
    campaign: row.campaign as string, source: row.source as string,
    subscribers: Number(row.subscribers), buyers: Number(row.buyers),
    revenue: Number(row.revenue_cents) / 100,
    conversionRate: Number(row.subscribers) > 0 ? ((Number(row.buyers) / Number(row.subscribers)) * 100).toFixed(1) + '%' : '0%',
  }));
}

export async function getRecentActivity(limit = 20, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT event_name, visitor_id, email, created_at FROM events WHERE COALESCE(channel_id, 'default') = ? ORDER BY created_at DESC LIMIT ?`, args: [ch, limit] });
  return result.rows.map(row => ({ event: row.event_name as string, visitor: (row.visitor_id as string).slice(0, 8), email: row.email as string|null, time: row.created_at as string }));
}

export async function getSubscribersByDay(days = 30, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT DATE(subscribed_at) as day, COUNT(*) as count FROM subscribers WHERE COALESCE(channel_id, 'default') = ? AND subscribed_at >= datetime('now', ? || ' days') GROUP BY DATE(subscribed_at) ORDER BY day ASC`, args: [ch, `-${days}`] });
  return result.rows.map(row => ({ day: row.day as string, count: Number(row.count) }));
}

export async function getRevenueByDay(days = 30, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT DATE(purchased_at) as day, SUM(amount_cents) as revenue_cents, COUNT(*) as count FROM purchases WHERE COALESCE(channel_id, 'default') = ? AND purchased_at >= datetime('now', ? || ' days') GROUP BY DATE(purchased_at) ORDER BY day ASC`, args: [ch, `-${days}`] });
  return result.rows.map(row => ({ day: row.day as string, revenue: Number(row.revenue_cents) / 100, count: Number(row.count) }));
}

export async function getCampaignPageviews(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT COALESCE(utm_campaign, 'direct') as campaign, COUNT(*) as views FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND utm_campaign IS NOT NULL AND utm_campaign != '' GROUP BY utm_campaign ORDER BY views DESC`, args: [ch] });
  return result.rows.map(row => ({ campaign: row.campaign as string, views: Number(row.views) }));
}

export async function getPageviewsByDay(days = 30, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT DATE(created_at) as day, COUNT(*) as views FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND created_at >= datetime('now', ? || ' days') GROUP BY DATE(created_at) ORDER BY day ASC`, args: [ch, `-${days}`] });
  return result.rows.map(row => ({ day: row.day as string, views: Number(row.views) }));
}

// ---- Cost tracking ----

export async function addCampaignCost(data: { utm_campaign: string; amount_cents: number; description?: string; spend_date?: string; channel_id?: string; }) {
  await ensureSchema();
  const db = getDb();
  await db.execute({ sql: `INSERT INTO campaign_costs (channel_id, utm_campaign, amount_cents, description, spend_date) VALUES (?, ?, ?, ?, ?)`, args: [data.channel_id||DC, data.utm_campaign, data.amount_cents, data.description||null, data.spend_date||new Date().toISOString().split('T')[0]] });
}

export async function getCampaignCosts(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT utm_campaign as campaign, SUM(amount_cents) as total_cents, COUNT(*) as entries FROM campaign_costs WHERE COALESCE(channel_id, 'default') = ? GROUP BY utm_campaign ORDER BY total_cents DESC`, args: [ch] });
  return result.rows.map(row => ({ campaign: row.campaign as string, totalSpend: Number(row.total_cents) / 100, entries: Number(row.entries) }));
}

export async function getCostEntries(campaign?: string, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = campaign
    ? await db.execute({ sql: `SELECT * FROM campaign_costs WHERE COALESCE(channel_id, 'default') = ? AND utm_campaign = ? ORDER BY spend_date DESC`, args: [ch, campaign] })
    : await db.execute({ sql: `SELECT * FROM campaign_costs WHERE COALESCE(channel_id, 'default') = ? ORDER BY spend_date DESC LIMIT 50`, args: [ch] });
  return result.rows.map(row => ({ id: Number(row.id), campaign: row.utm_campaign as string, amount: Number(row.amount_cents) / 100, description: row.description as string|null, date: row.spend_date as string }));
}

// ---- Subscriber quality scoring ----

export async function getSubscriberScoring(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT COALESCE(s.utm_campaign, 'direct') as campaign, COALESCE(s.utm_source, 'unknown') as source,
      COUNT(DISTINCT s.email) as total_subs, COUNT(DISTINCT p.email) as buyers, COALESCE(SUM(p.amount_cents), 0) as revenue_cents,
      ROUND(CAST(COUNT(DISTINCT p.email) AS FLOAT) / NULLIF(COUNT(DISTINCT s.email), 0) * 100, 1) as buy_rate,
      ROUND(CAST(COALESCE(SUM(p.amount_cents), 0) AS FLOAT) / NULLIF(COUNT(DISTINCT s.email), 0) / 100, 2) as rev_per_sub
    FROM subscribers s LEFT JOIN purchases p ON s.email = p.email AND COALESCE(p.channel_id, 'default') = ?
    WHERE COALESCE(s.channel_id, 'default') = ? GROUP BY s.utm_campaign, s.utm_source ORDER BY rev_per_sub DESC`,
    args: [ch, ch],
  });
  return result.rows.map(row => {
    const revPerSub = Number(row.rev_per_sub) || 0;
    const buyRate = Number(row.buy_rate) || 0;
    let grade = 'D';
    if (revPerSub >= 5) grade = 'A'; else if (revPerSub >= 2) grade = 'B'; else if (buyRate > 0) grade = 'C';
    return { campaign: row.campaign as string, source: row.source as string, totalSubs: Number(row.total_subs), buyers: Number(row.buyers), revenue: Number(row.revenue_cents) / 100, buyRate, revPerSub, grade };
  });
}

// ---- Weekly stats ----

export async function getWeeklyStats(weeks = 12, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const d = `-${weeks * 7}`;
  const [pvR, subR, revR] = await Promise.all([
    db.execute({ sql: `SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as count FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND created_at >= datetime('now', ? || ' days') GROUP BY week ORDER BY week ASC`, args: [ch, d] }),
    db.execute({ sql: `SELECT strftime('%Y-W%W', subscribed_at) as week, COUNT(*) as count FROM subscribers WHERE COALESCE(channel_id, 'default') = ? AND subscribed_at >= datetime('now', ? || ' days') GROUP BY week ORDER BY week ASC`, args: [ch, d] }),
    db.execute({ sql: `SELECT strftime('%Y-W%W', purchased_at) as week, COUNT(*) as count, COALESCE(SUM(amount_cents),0) as rev FROM purchases WHERE COALESCE(channel_id, 'default') = ? AND purchased_at >= datetime('now', ? || ' days') GROUP BY week ORDER BY week ASC`, args: [ch, d] }),
  ]);
  return {
    pageviews: pvR.rows.map(r => ({ week: r.week as string, count: Number(r.count) })),
    subscribers: subR.rows.map(r => ({ week: r.week as string, count: Number(r.count) })),
    revenue: revR.rows.map(r => ({ week: r.week as string, count: Number(r.count), revenue: Number(r.rev) / 100 })),
  };
}

// ---- Daily summary ----

export async function getDailySummary(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const [pv, subs, purchases, uniqueVis] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND DATE(created_at) = ?`, args: [ch, today] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM subscribers WHERE COALESCE(channel_id, 'default') = ? AND DATE(subscribed_at) = ?`, args: [ch, today] }),
    db.execute({ sql: `SELECT COUNT(*) as c, COALESCE(SUM(amount_cents),0) as rev FROM purchases WHERE COALESCE(channel_id, 'default') = ? AND DATE(purchased_at) = ?`, args: [ch, today] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND DATE(created_at) = ?`, args: [ch, today] }),
  ]);
  return { date: today, pageviews: Number(pv.rows[0].c), uniqueVisitors: Number(uniqueVis.rows[0].c), subscribers: Number(subs.rows[0].c), purchases: Number(purchases.rows[0].c), revenue: Number(purchases.rows[0].rev) / 100 };
}

// ---- Refund stats ----

export async function getRefundStats(ch = DC) {
  await ensureSchema();
  const db = getDb();
  const [total, sevenDay, thirtyDay, purchases7d, purchases30d] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c, COALESCE(SUM(amount_cents),0) as amt FROM refunds WHERE COALESCE(channel_id, 'default') = ?`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as refunds FROM refunds WHERE COALESCE(channel_id, 'default') = ? AND refunded_at >= datetime('now', '-7 days')`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as refunds FROM refunds WHERE COALESCE(channel_id, 'default') = ? AND refunded_at >= datetime('now', '-30 days')`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM purchases WHERE COALESCE(channel_id, 'default') = ? AND purchased_at >= datetime('now', '-7 days')`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM purchases WHERE COALESCE(channel_id, 'default') = ? AND purchased_at >= datetime('now', '-30 days')`, args: [ch] }),
  ]);
  const ref7 = Number(sevenDay.rows[0].refunds), pur7 = Number(purchases7d.rows[0].c);
  const ref30 = Number(thirtyDay.rows[0].refunds), pur30 = Number(purchases30d.rows[0].c);
  return { totalRefunds: Number(total.rows[0].c), totalRefundedAmount: Number(total.rows[0].amt) / 100, refundRate7d: pur7 > 0 ? +((ref7 / pur7) * 100).toFixed(1) : 0, refundRate30d: pur30 > 0 ? +((ref30 / pur30) * 100).toFixed(1) : 0 };
}

// ---- VSL stats ----

export async function getVSLStats(days?: number, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const df = days ? `AND created_at >= datetime('now', '-${days} days')` : '';

  const [visits, uniqueVisits, milestones, ctaClicks] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND (page = 'vsl' OR page = 'offer') ${df}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND (page = 'vsl' OR page = 'offer') ${df}`, args: [ch] }),
    db.execute({ sql: `SELECT event_name, COUNT(DISTINCT visitor_id) as unique_count FROM events WHERE COALESCE(channel_id, 'default') = ? AND event_name IN ('vsl_watch_25','vsl_watch_50','vsl_watch_75','vsl_complete') ${df} GROUP BY event_name`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as unique_count FROM events WHERE COALESCE(channel_id, 'default') = ? AND event_name = 'cta_click' ${df}`, args: [ch] }),
  ]);

  const mm: Record<string, number> = {};
  for (const row of milestones.rows) mm[row.event_name as string] = Number(row.unique_count);

  const tv = Number(visits.rows[0].c), uv = Number(uniqueVisits.rows[0].c), cta = Number(ctaClicks.rows[0].unique_count);
  return { totalVisits: tv, uniqueVisitors: uv, watch25: mm['vsl_watch_25']||0, watch50: mm['vsl_watch_50']||0, watch75: mm['vsl_watch_75']||0, watchComplete: mm['vsl_complete']||0, ctaClicks: cta, ctaRate: uv > 0 ? +((cta / uv) * 100).toFixed(1) : 0 };
}

// ---- Checkout stats ----

export async function getCheckoutStats(days?: number, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const df = days ? `AND created_at >= datetime('now', '-${days} days')` : '';
  const dpf = days ? `AND purchased_at >= datetime('now', '-${days} days')` : '';

  const [checkoutStarts, purchases] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM events WHERE COALESCE(channel_id, 'default') = ? AND event_name = 'checkout_start' ${df}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as c, COALESCE(SUM(amount_cents),0) as rev FROM purchases WHERE COALESCE(channel_id, 'default') = ? ${dpf ? dpf.replace('AND', 'AND') : ''}`, args: [ch] }),
  ]);

  const refunds = await getRefundStats(ch);
  const starts = Number(checkoutStarts.rows[0].c), completed = Number(purchases.rows[0].c);
  return { checkoutStarts: starts, completedPurchases: completed, abandonmentRate: starts > 0 ? +((1 - completed / starts) * 100).toFixed(1) : 0, revenue: Number(purchases.rows[0].rev) / 100, ...refunds };
}

// ---- Full funnel flow ----

export async function getFunnelFlow(days?: number, ch = DC) {
  await ensureSchema();
  const db = getDb();
  const pf = days ? `AND created_at >= datetime('now', '-${days} days')` : '';
  const sf = days ? `AND subscribed_at >= datetime('now', '-${days} days')` : '';
  const ppf = days ? `AND purchased_at >= datetime('now', '-${days} days')` : '';
  const ef = days ? `AND created_at >= datetime('now', '-${days} days')` : '';

  const [pageVisits, uniquePageVisits, subs, vslVisits, ctaClicks, purchases] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? ${pf}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? ${pf}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM subscribers WHERE COALESCE(channel_id, 'default') = ? ${sf}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM pageviews WHERE COALESCE(channel_id, 'default') = ? AND (page = 'vsl' OR page = 'offer') ${pf}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(DISTINCT visitor_id) as c FROM events WHERE COALESCE(channel_id, 'default') = ? AND event_name = 'cta_click' ${ef}`, args: [ch] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM purchases WHERE COALESCE(channel_id, 'default') = ? ${ppf}`, args: [ch] }),
  ]);

  const pv = Number(pageVisits.rows[0].c), upv = Number(uniquePageVisits.rows[0].c);
  const sub = Number(subs.rows[0].c), vsl = Number(vslVisits.rows[0].c);
  const cta = Number(ctaClicks.rows[0].c), pur = Number(purchases.rows[0].c);

  return {
    pageVisits: pv, uniqueVisitors: upv, subscribers: sub, vslVisitors: vsl, ctaClicks: cta, purchases: pur,
    rates: {
      visitToSub: pv > 0 ? +((sub / pv) * 100).toFixed(1) : 0,
      subToVsl: sub > 0 ? +((vsl / sub) * 100).toFixed(1) : 0,
      vslToCta: vsl > 0 ? +((cta / vsl) * 100).toFixed(1) : 0,
      ctaToPurchase: cta > 0 ? +((pur / cta) * 100).toFixed(1) : 0,
      overallConversion: pv > 0 ? +((pur / pv) * 100).toFixed(2) : 0,
    },
  };
}

// ---- Settings ----

export async function getSetting(key: string): Promise<string | null> {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [key] });
  return result.rows.length > 0 ? (result.rows[0].value as string) : null;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute(`SELECT key, value FROM settings`);
  const settings: Record<string, string> = {};
  for (const row of result.rows) settings[row.key as string] = row.value as string;
  return settings;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({ sql: `DELETE FROM settings WHERE key = ?`, args: [key] });
}
