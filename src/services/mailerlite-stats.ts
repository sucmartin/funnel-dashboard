import { config } from '../config';

const ML_API = 'https://connect.mailerlite.com/api';

async function mlFetch(endpoint: string, apiKey?: string) {
  const key = apiKey || config.mailerlite.apiKey;
  if (!key) throw new Error('MailerLite API key not configured');
  const res = await fetch(`${ML_API}/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${key}`,
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

export async function getEmailCampaigns(limit = 20, apiKey?: string): Promise<EmailCampaignStats[]> {
  const data = await mlFetch(`campaigns?filter[status]=sent&limit=${limit}&sort=-created_at`, apiKey) as any;
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

export async function getGroupStats(groupId?: string, apiKey?: string) {
  const gid = groupId || config.mailerlite.groupId;
  if (!gid) return null;
  try {
    const data = await mlFetch(`groups/${gid}`, apiKey) as any;
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
