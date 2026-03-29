import { config } from '../config';

const ML_API = 'https://connect.mailerlite.com/api';

async function mlFetch(endpoint: string) {
  if (!config.mailerlite.apiKey) throw new Error('MailerLite API key not configured');
  const res = await fetch(`${ML_API}/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${config.mailerlite.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MailerLite API ${res.status}: ${err}`);
  }
  return res.json();
}

export interface EmailCampaignStats {
  id: string;
  name: string;
  status: string;
  type: string;
  sentAt: string | null;
  stats: {
    sent: number;
    opens: number;
    clicks: number;
    unsubscribes: number;
    openRate: number;
    clickRate: number;
  };
}

export async function getEmailCampaigns(limit = 20): Promise<EmailCampaignStats[]> {
  const data = await mlFetch(`campaigns?filter[status]=sent&limit=${limit}&sort=-created_at`);
  return (data.data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    type: c.type,
    sentAt: c.scheduled_for || c.created_at,
    stats: {
      sent: c.stats?.sent || 0,
      opens: c.stats?.opens_count || 0,
      clicks: c.stats?.clicks_count || 0,
      unsubscribes: c.stats?.unsubscribes_count || 0,
      openRate: c.stats?.open_rate ? parseFloat(c.stats.open_rate) : 0,
      clickRate: c.stats?.click_rate ? parseFloat(c.stats.click_rate) : 0,
    },
  }));
}

export interface SubscriberOverview {
  total: number;
  active: number;
  unsubscribed: number;
  unconfirmed: number;
}

export async function getSubscriberOverview(): Promise<SubscriberOverview> {
  const data = await mlFetch('subscribers?limit=0');
  return {
    total: data.total || 0,
    active: data.total || 0,
    unsubscribed: 0,
    unconfirmed: 0,
  };
}

export async function getGroupStats() {
  if (!config.mailerlite.groupId) return null;
  try {
    const data = await mlFetch(`groups/${config.mailerlite.groupId}`);
    return {
      id: data.data?.id,
      name: data.data?.name,
      activeCount: data.data?.active_count || 0,
      sentCount: data.data?.sent_count || 0,
      openRate: data.data?.open_rate?.float || 0,
      clickRate: data.data?.click_rate?.float || 0,
    };
  } catch {
    return null;
  }
}
