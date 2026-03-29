import { getDb, ensureSchema } from './connection';

export async function insertPageview(data: {
  page: string;
  visitor_id: string;
  utm_source?: string;
  utm_campaign?: string;
  utm_medium?: string;
  referrer?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO pageviews (page, visitor_id, utm_source, utm_campaign, utm_medium, referrer)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [data.page, data.visitor_id, data.utm_source || null, data.utm_campaign || null, data.utm_medium || null, data.referrer || null],
  });
}

export async function insertEvent(data: {
  event_name: string;
  visitor_id: string;
  email?: string;
  metadata?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO events (event_name, visitor_id, email, metadata)
          VALUES (?, ?, ?, ?)`,
    args: [data.event_name, data.visitor_id, data.email || null, data.metadata || null],
  });
}

export async function upsertSubscriber(data: {
  email: string;
  visitor_id: string;
  utm_source?: string;
  utm_campaign?: string;
  utm_medium?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO subscribers (email, visitor_id, utm_source, utm_campaign, utm_medium)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            visitor_id = excluded.visitor_id,
            utm_source = COALESCE(excluded.utm_source, subscribers.utm_source),
            utm_campaign = COALESCE(excluded.utm_campaign, subscribers.utm_campaign),
            utm_medium = COALESCE(excluded.utm_medium, subscribers.utm_medium)`,
    args: [data.email, data.visitor_id, data.utm_source || null, data.utm_campaign || null, data.utm_medium || null],
  });
}

export async function getLatestPageviewUtms(visitor_id: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT utm_source, utm_campaign, utm_medium
          FROM pageviews WHERE visitor_id = ?
          ORDER BY created_at DESC LIMIT 1`,
    args: [visitor_id],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    utm_source: row.utm_source as string | null,
    utm_campaign: row.utm_campaign as string | null,
    utm_medium: row.utm_medium as string | null,
  };
}

export async function insertPurchase(data: {
  email: string;
  amount_cents: number;
  currency: string;
  stripe_session_id: string;
  utm_campaign?: string;
  utm_source?: string;
  purchased_at: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO purchases (email, amount_cents, currency, stripe_session_id, utm_campaign, utm_source, purchased_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [data.email, data.amount_cents, data.currency, data.stripe_session_id, data.utm_campaign || null, data.utm_source || null, data.purchased_at],
  });
}

export async function getSubscriberByEmail(email: string) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM subscribers WHERE email = ?`,
    args: [email],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    email: row.email as string,
    utm_source: row.utm_source as string | null,
    utm_campaign: row.utm_campaign as string | null,
  };
}

// ---- Dashboard queries ----

export async function getDashboardStats() {
  await ensureSchema();
  const db = getDb();

  const [pageviews, subscribers, purchases, events] = await Promise.all([
    db.execute('SELECT COUNT(*) as count FROM pageviews'),
    db.execute('SELECT COUNT(*) as count FROM subscribers'),
    db.execute('SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as revenue FROM purchases'),
    db.execute('SELECT COUNT(*) as count FROM events'),
  ]);

  return {
    totalPageviews: Number(pageviews.rows[0].count),
    totalSubscribers: Number(subscribers.rows[0].count),
    totalPurchases: Number(purchases.rows[0].count),
    totalRevenue: Number(purchases.rows[0].revenue) / 100,
    totalEvents: Number(events.rows[0].count),
  };
}

export async function getCampaignBreakdown() {
  await ensureSchema();
  const db = getDb();

  const result = await db.execute(`
    SELECT
      COALESCE(s.utm_campaign, 'direct') as campaign,
      COALESCE(s.utm_source, 'unknown') as source,
      COUNT(DISTINCT s.email) as subscribers,
      COUNT(DISTINCT p.email) as buyers,
      COALESCE(SUM(p.amount_cents), 0) as revenue_cents
    FROM subscribers s
    LEFT JOIN purchases p ON s.email = p.email
    GROUP BY s.utm_campaign, s.utm_source
    ORDER BY subscribers DESC
  `);

  return result.rows.map(row => ({
    campaign: row.campaign as string,
    source: row.source as string,
    subscribers: Number(row.subscribers),
    buyers: Number(row.buyers),
    revenue: Number(row.revenue_cents) / 100,
    conversionRate: Number(row.subscribers) > 0
      ? ((Number(row.buyers) / Number(row.subscribers)) * 100).toFixed(1) + '%'
      : '0%',
  }));
}

export async function getRecentActivity(limit = 20) {
  await ensureSchema();
  const db = getDb();

  const result = await db.execute({
    sql: `SELECT event_name, visitor_id, email, created_at
          FROM events ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });

  return result.rows.map(row => ({
    event: row.event_name as string,
    visitor: (row.visitor_id as string).slice(0, 8),
    email: row.email as string | null,
    time: row.created_at as string,
  }));
}

export async function getSubscribersByDay(days = 30) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT DATE(subscribed_at) as day, COUNT(*) as count
          FROM subscribers
          WHERE subscribed_at >= datetime('now', ? || ' days')
          GROUP BY DATE(subscribed_at)
          ORDER BY day ASC`,
    args: [`-${days}`],
  });
  return result.rows.map(row => ({
    day: row.day as string,
    count: Number(row.count),
  }));
}

export async function getRevenueByDay(days = 30) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT DATE(purchased_at) as day, SUM(amount_cents) as revenue_cents, COUNT(*) as count
          FROM purchases
          WHERE purchased_at >= datetime('now', ? || ' days')
          GROUP BY DATE(purchased_at)
          ORDER BY day ASC`,
    args: [`-${days}`],
  });
  return result.rows.map(row => ({
    day: row.day as string,
    revenue: Number(row.revenue_cents) / 100,
    count: Number(row.count),
  }));
}

export async function getCampaignPageviews() {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute(`
    SELECT COALESCE(utm_campaign, 'direct') as campaign, COUNT(*) as views
    FROM pageviews
    WHERE utm_campaign IS NOT NULL AND utm_campaign != ''
    GROUP BY utm_campaign
    ORDER BY views DESC
  `);
  return result.rows.map(row => ({
    campaign: row.campaign as string,
    views: Number(row.views),
  }));
}

export async function getPageviewsByDay(days = 30) {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT DATE(created_at) as day, COUNT(*) as views
          FROM pageviews
          WHERE created_at >= datetime('now', ? || ' days')
          GROUP BY DATE(created_at)
          ORDER BY day ASC`,
    args: [`-${days}`],
  });
  return result.rows.map(row => ({
    day: row.day as string,
    views: Number(row.views),
  }));
}

// ---- Cost tracking ----

export async function addCampaignCost(data: {
  utm_campaign: string;
  amount_cents: number;
  description?: string;
  spend_date?: string;
}) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO campaign_costs (utm_campaign, amount_cents, description, spend_date)
          VALUES (?, ?, ?, ?)`,
    args: [data.utm_campaign, data.amount_cents, data.description || null, data.spend_date || new Date().toISOString().split('T')[0]],
  });
}

export async function getCampaignCosts() {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute(`
    SELECT utm_campaign as campaign, SUM(amount_cents) as total_cents, COUNT(*) as entries
    FROM campaign_costs
    GROUP BY utm_campaign
    ORDER BY total_cents DESC
  `);
  return result.rows.map(row => ({
    campaign: row.campaign as string,
    totalSpend: Number(row.total_cents) / 100,
    entries: Number(row.entries),
  }));
}

export async function getCostEntries(campaign?: string) {
  await ensureSchema();
  const db = getDb();
  const result = campaign
    ? await db.execute({ sql: `SELECT * FROM campaign_costs WHERE utm_campaign = ? ORDER BY spend_date DESC`, args: [campaign] })
    : await db.execute(`SELECT * FROM campaign_costs ORDER BY spend_date DESC LIMIT 50`);
  return result.rows.map(row => ({
    id: Number(row.id),
    campaign: row.utm_campaign as string,
    amount: Number(row.amount_cents) / 100,
    description: row.description as string | null,
    date: row.spend_date as string,
  }));
}

// ---- Subscriber quality scoring ----

export async function getSubscriberScoring() {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute(`
    SELECT
      COALESCE(s.utm_campaign, 'direct') as campaign,
      COALESCE(s.utm_source, 'unknown') as source,
      COUNT(DISTINCT s.email) as total_subs,
      COUNT(DISTINCT p.email) as buyers,
      COALESCE(SUM(p.amount_cents), 0) as revenue_cents,
      ROUND(CAST(COUNT(DISTINCT p.email) AS FLOAT) / NULLIF(COUNT(DISTINCT s.email), 0) * 100, 1) as buy_rate,
      ROUND(CAST(COALESCE(SUM(p.amount_cents), 0) AS FLOAT) / NULLIF(COUNT(DISTINCT s.email), 0) / 100, 2) as rev_per_sub
    FROM subscribers s
    LEFT JOIN purchases p ON s.email = p.email
    GROUP BY s.utm_campaign, s.utm_source
    ORDER BY rev_per_sub DESC
  `);
  return result.rows.map(row => {
    const revPerSub = Number(row.rev_per_sub) || 0;
    const buyRate = Number(row.buy_rate) || 0;
    let grade = 'D';
    if (revPerSub >= 5) grade = 'A';
    else if (revPerSub >= 2) grade = 'B';
    else if (buyRate > 0) grade = 'C';
    return {
      campaign: row.campaign as string,
      source: row.source as string,
      totalSubs: Number(row.total_subs),
      buyers: Number(row.buyers),
      revenue: Number(row.revenue_cents) / 100,
      buyRate: buyRate,
      revPerSub: revPerSub,
      grade,
    };
  });
}

// ---- Weekly/Monthly aggregations ----

export async function getWeeklyStats(weeks = 12) {
  await ensureSchema();
  const db = getDb();
  const [pvResult, subResult, revResult] = await Promise.all([
    db.execute({
      sql: `SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as count
            FROM pageviews WHERE created_at >= datetime('now', ? || ' days')
            GROUP BY week ORDER BY week ASC`,
      args: [`-${weeks * 7}`],
    }),
    db.execute({
      sql: `SELECT strftime('%Y-W%W', subscribed_at) as week, COUNT(*) as count
            FROM subscribers WHERE subscribed_at >= datetime('now', ? || ' days')
            GROUP BY week ORDER BY week ASC`,
      args: [`-${weeks * 7}`],
    }),
    db.execute({
      sql: `SELECT strftime('%Y-W%W', purchased_at) as week, COUNT(*) as count, COALESCE(SUM(amount_cents),0) as rev
            FROM purchases WHERE purchased_at >= datetime('now', ? || ' days')
            GROUP BY week ORDER BY week ASC`,
      args: [`-${weeks * 7}`],
    }),
  ]);
  return {
    pageviews: pvResult.rows.map(r => ({ week: r.week as string, count: Number(r.count) })),
    subscribers: subResult.rows.map(r => ({ week: r.week as string, count: Number(r.count) })),
    revenue: revResult.rows.map(r => ({ week: r.week as string, count: Number(r.count), revenue: Number(r.rev) / 100 })),
  };
}

// ---- Daily summary for notifications ----

export async function getDailySummary() {
  await ensureSchema();
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const [pv, subs, purchases] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as c FROM pageviews WHERE DATE(created_at) = ?`, args: [today] }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM subscribers WHERE DATE(subscribed_at) = ?`, args: [today] }),
    db.execute({ sql: `SELECT COUNT(*) as c, COALESCE(SUM(amount_cents),0) as rev FROM purchases WHERE DATE(purchased_at) = ?`, args: [today] }),
  ]);
  return {
    date: today,
    pageviews: Number(pv.rows[0].c),
    subscribers: Number(subs.rows[0].c),
    purchases: Number(purchases.rows[0].c),
    revenue: Number(purchases.rows[0].rev) / 100,
  };
}
