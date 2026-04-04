import { getChannelConfig } from '../config';

interface SubscribeParams {
  email: string;
  utm_campaign?: string;
  utm_source?: string;
  channel_id?: string;
}

export async function addSubscriberToMailerLite(params: SubscribeParams): Promise<{ success: boolean; error?: string }> {
  const { email, utm_campaign, utm_source, channel_id } = params;

  // Get per-channel MailerLite credentials (falls back to global)
  const cfg = await getChannelConfig(channel_id);

  if (!cfg.mailerliteApiKey) {
    console.warn('[MailerLite] No API key configured for channel:', channel_id || 'default');
    return { success: false, error: 'No MailerLite API key' };
  }

  const body: Record<string, unknown> = {
    email,
    fields: {
      utm_campaign: utm_campaign || 'direct',
      utm_source: utm_source || 'unknown',
    },
  };

  if (cfg.mailerliteGroupId) {
    body.groups = [cfg.mailerliteGroupId];
  }

  try {
    const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.mailerliteApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[MailerLite] API error (channel=${channel_id || 'default'}):`, response.status, errorData);
      return { success: false, error: `MailerLite API ${response.status}: ${errorData}` };
    }

    console.log(`[MailerLite] Subscriber added: ${email} | channel=${channel_id || 'default'} | group=${cfg.mailerliteGroupId || 'none'}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MailerLite] Request failed:', message);
    return { success: false, error: message };
  }
}
