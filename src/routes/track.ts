import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { insertPageview, insertEvent, upsertSubscriber, getLatestPageviewUtms } from '../db/queries';
import { addSubscriberToMailerLite } from '../services/mailerlite';

const router = Router();

const pageviewSchema = z.object({
  visitor_id: z.string().min(1),
  page: z.string().min(1),
  utm_source: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_medium: z.string().optional(),
  referrer: z.string().optional(),
  channel_id: z.string().optional(),
  email_source: z.string().optional(),
});

const eventSchema = z.object({
  visitor_id: z.string().min(1),
  event_name: z.string().min(1),
  email: z.string().email().optional(),
  metadata: z.record(z.unknown()).optional(),
  channel_id: z.string().optional(),
});

// POST /api/track/pageview
router.post('/pageview', async (req: Request, res: Response) => {
  const parsed = pageviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await insertPageview(parsed.data);
    console.log(`[Track] Pageview: ${parsed.data.page} | visitor=${parsed.data.visitor_id} | utm_campaign=${parsed.data.utm_campaign || 'none'}`);
    res.status(204).send();
  } catch (err) {
    console.error('[Track] Pageview insert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/track/event
router.post('/event', async (req: Request, res: Response) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { event_name, visitor_id, email, metadata } = parsed.data;

  try {
    await insertEvent({
      event_name,
      visitor_id,
      email,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });

    console.log(`[Track] Event: ${event_name} | visitor=${visitor_id}${email ? ` | email=${email}` : ''}`);

    // On opt-in submit: upsert subscriber + send to MailerLite
    if (event_name === 'optin_submit' && email) {
      const utms = await getLatestPageviewUtms(visitor_id);
      const utm_source = utms?.utm_source || undefined;
      const utm_campaign = utms?.utm_campaign || undefined;
      const utm_medium = utms?.utm_medium || undefined;

      await upsertSubscriber({ email, visitor_id, utm_source, utm_campaign, utm_medium, channel_id: parsed.data.channel_id });

      // Fire-and-forget MailerLite call (don't block response)
      addSubscriberToMailerLite({ email, utm_campaign, utm_source }).catch(err => {
        console.error('[Track] MailerLite background error:', err);
      });
    }

    res.status(204).send();
  } catch (err) {
    console.error('[Track] Event insert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
