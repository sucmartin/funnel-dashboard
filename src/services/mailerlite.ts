import { config } from '../config';

interface SubscribeParams {
  email: string;
  utm_campaign?: string;
  utm_source?: string;
}

export async function addSubscriberToMailerLite(params: SubscribeParams): Promise<{ success: boolean; error?: string }> {
  const { email, utm_campaign, utm_source } = params;

  const body: Record<string, unknown> = {
    email,
    fields: {
      utm_campaign: utm_campaign || 'direct',
      utm_source: utm_source || 'unknown',
    },
  };

  if (config.mailerlite.groupId) {
    body.groups = [config.mailerlite.groupId];
  }

  try {
    const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.mailerlite.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[MailerLite] API error:', response.status, errorData);
      return { success: false, error: `MailerLite API ${response.status}: ${errorData}` };
    }

    console.log(`[MailerLite] Subscriber added/updated: ${email}, utm_campaign=${utm_campaign || 'direct'}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MailerLite] Request failed:', message);
    return { success: false, error: message };
  }
}
