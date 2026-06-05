import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { config, getChannelConfig } from '../config';
import { insertPurchase, insertRefund, getSubscriberByEmail, getLatestEmailSource, getLatestPageviewUtms, getChannels } from '../db/queries';

const router = Router();

function getStripe() {
  return new Stripe(config.stripe.secretKey);
}

function verifyWebhook(req: Request): Stripe.Event | null {
  const sig = req.headers['stripe-signature'] as string;
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    console.warn('[Stripe] No webhook secret configured');
    return null;
  }
  try {
    return getStripe().webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret!);
  } catch (err) {
    console.error('[Stripe] Signature verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Sources that mean "an internal email drove the final click", not a real acquisition channel.
const EMAIL_SOURCES = new Set(['email', 'mailerlite', 'newsletter', 'getresponse']);

// Decide what gets credited for a sale. Two distinct cases:
//  - Direct traffic (e.g. utm_source=youtube on the getsourcecode.co link): the checkout UTM
//    IS the acquisition source, so it fills utm_source/utm_campaign.
//  - Email/funnel traffic (utm_source=email): the real acquisition source was captured back at
//    opt-in and lives on the subscriber record; the email campaign becomes email_source instead,
//    so the acquisition channels you're testing aren't all buried under "email".
function resolveAttribution(
  md: Record<string, string>,
  subscriber: { utm_source?: string | null; utm_campaign?: string | null } | null | undefined,
  pageviewUtms?: { utm_source?: string | null; utm_campaign?: string | null } | null,
): { utm_source?: string; utm_campaign?: string; email_source?: string } {
  const lastSource = (md.ng_utm_source || md.utm_source || '').toLowerCase();
  const lastCampaign = md.ng_utm_campaign || md.utm_campaign || '';

  if (lastSource && !EMAIL_SOURCES.has(lastSource)) {
    return { utm_source: lastSource, utm_campaign: lastCampaign || undefined, email_source: undefined };
  }
  return {
    utm_source: subscriber?.utm_source || pageviewUtms?.utm_source || undefined,
    utm_campaign: subscriber?.utm_campaign || pageviewUtms?.utm_campaign || undefined,
    email_source: EMAIL_SOURCES.has(lastSource) ? (lastCampaign || undefined) : undefined,
  };
}

// Find which channel a checkout session belongs to by matching product IDs
async function findChannelForSession(session: Stripe.Checkout.Session): Promise<string | null> {
  try {
    const stripe = getStripe();
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });
    const sessionProductIds = lineItems.data.map(item => {
      return typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
    }).filter(Boolean) as string[];

    if (sessionProductIds.length === 0) return null;

    // Check each channel's product IDs
    const channels = await getChannels();
    for (const ch of channels) {
      if (!ch.stripe_product_ids) continue;
      const channelProducts = ch.stripe_product_ids.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (channelProducts.length === 0) continue;
      for (const pid of sessionProductIds) {
        if (channelProducts.includes(pid)) {
          console.log(`[Stripe] Matched product ${pid} to channel "${ch.id}"`);
          return ch.id;
        }
      }
    }

    // Fallback: check global product IDs
    if (config.stripe.productIds.length === 0) {
      // No product filtering at all — track under 'default'
      return 'default';
    }
    for (const pid of sessionProductIds) {
      if (config.stripe.productIds.includes(pid)) return 'default';
    }

    console.log(`[Stripe] Session ${session.id} skipped — no matching product IDs (found: ${sessionProductIds.join(', ')})`);
    return null;
  } catch (err) {
    console.error('[Stripe] Failed to check line items:', err);
    return null;
  }
}

// Find channel for a charge (refunds)
async function findChannelForCharge(charge: Stripe.Charge): Promise<string | null> {
  try {
    const stripe = getStripe();
    if (charge.payment_intent) {
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent.id;
      const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
      if (sessions.data.length > 0) {
        return findChannelForSession(sessions.data[0]);
      }
      // No Checkout Session — this is the custom $297 PaymentIntent flow. Check its metadata.
      const pi = await stripe.paymentIntents.retrieve(piId);
      const md = (pi.metadata || {}) as Record<string, string>;
      if (md.product === 'the-source-code') return 'default';
    }
    return null;
  } catch (err) {
    console.error('[Stripe] Failed to check charge product:', err);
    return null;
  }
}

// POST /api/webhooks/stripe
router.post('/stripe', async (req: Request, res: Response) => {
  const event = verifyWebhook(req);
  if (!event) {
    res.status(400).json({ error: 'Webhook verification failed' });
    return;
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_email || session.customer_details?.email;
    const amount = session.amount_total || 0;
    const currency = session.currency || 'usd';

    if (email) {
      const md = (session.metadata || {}) as Record<string, string>;

      // getsourcecode.co tags its sales in metadata. Trust that first — the $297/$197
      // offers have no Stripe Price object, so product-ID matching can't identify them.
      let channelId: string | null =
        (md.product === 'the-source-code' || md.bridge === 'true') ? 'default' : null;
      if (!channelId) channelId = await findChannelForSession(session);
      if (!channelId) {
        console.log(`[Stripe] Ignoring purchase from ${email} — not a tracked product`);
        res.json({ received: true });
        return;
      }

      // Attribution: try multiple methods to identify the visitor
      const subscriber = await getSubscriberByEmail(email);
      const clientRefId = (session as any).client_reference_id as string | null;
      const visitorId = clientRefId || subscriber?.visitor_id || null;

      // Stripe metadata is the only attribution that survives the cross-domain hop
      // (goddardsecrets.com -> getsourcecode.co), where cookies/sessionStorage are lost.
      const pageviewUtms = visitorId ? await getLatestPageviewUtms(visitorId) : null;
      const attr = resolveAttribution(md, subscriber, pageviewUtms);
      const utmSource = attr.utm_source;
      const utmCampaign = attr.utm_campaign;
      let emailSource = attr.email_source;
      if (!emailSource && visitorId) emailSource = (await getLatestEmailSource(visitorId)) || undefined;

      await insertPurchase({
        email,
        amount_cents: amount,
        currency,
        stripe_session_id: session.id,
        utm_campaign: utmCampaign,
        utm_source: utmSource,
        purchased_at: new Date(session.created * 1000).toISOString(),
        email_source: emailSource,
        channel_id: channelId,
      });
      console.log(`[Stripe] Purchase recorded: ${email} | $${(amount / 100).toFixed(2)} | channel=${channelId} | campaign=${utmCampaign || 'unknown'}`);
    }
  }

  // Handle payment_intent.succeeded — the $297 TSC sale on getsourcecode.co uses a
  // custom PaymentIntent flow (no Checkout Session), so the handler above never sees it.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const md = (pi.metadata || {}) as Record<string, string>;

    // Only record the TSC PaymentIntent sale. Bridge/other PIs don't carry this tag,
    // which also prevents double-counting (the bridge is recorded via its Checkout Session).
    if (md.product === 'the-source-code' && md.test_mode !== 'true') {
      const email = pi.receipt_email || md.email;
      if (email) {
        const amount = pi.amount_received || pi.amount || 0;
        const subscriber = await getSubscriberByEmail(email);
        const visitorId = subscriber?.visitor_id || null;
        const attr = resolveAttribution(md, subscriber, null);
        const utmSource = attr.utm_source;
        const utmCampaign = attr.utm_campaign;
        let emailSource = attr.email_source;
        if (!emailSource && visitorId) emailSource = (await getLatestEmailSource(visitorId)) || undefined;

        await insertPurchase({
          email,
          amount_cents: amount,
          currency: pi.currency || 'usd',
          stripe_session_id: pi.id, // unique key — dedupes redelivered events
          utm_campaign: utmCampaign,
          utm_source: utmSource,
          purchased_at: new Date(pi.created * 1000).toISOString(),
          email_source: emailSource,
          channel_id: 'default',
        });
        console.log(`[Stripe] PaymentIntent purchase recorded: ${email} | $${(amount / 100).toFixed(2)} | channel=default | campaign=${utmCampaign || 'unknown'}`);
      }
    }
  }

  // Handle charge.refunded
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const email = charge.billing_details?.email || charge.receipt_email;
    const refundedAmount = charge.amount_refunded || 0;
    const currency = charge.currency || 'usd';

    if (email) {
      const channelId = await findChannelForCharge(charge);
      if (!channelId) {
        console.log(`[Stripe] Ignoring refund for ${email} — not a tracked product`);
        res.json({ received: true });
        return;
      }

      await insertRefund({
        email,
        amount_cents: refundedAmount,
        currency,
        stripe_charge_id: charge.id,
        refunded_at: new Date().toISOString(),
        channel_id: channelId,
      });
      console.log(`[Stripe] Refund recorded: ${email} | $${(refundedAmount / 100).toFixed(2)} | channel=${channelId}`);
    }
  }

  res.json({ received: true });
});

export default router;
