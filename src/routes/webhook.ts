import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config';
import { insertPurchase, insertRefund, getSubscriberByEmail, getLatestEmailSource } from '../db/queries';

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

// Check if a checkout session contains one of our tracked products
async function isTrackedProduct(session: Stripe.Checkout.Session): Promise<boolean> {
  // If no product IDs configured, track everything (backwards compatible)
  if (config.stripe.productIds.length === 0) return true;

  try {
    const stripe = getStripe();
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });

    for (const item of lineItems.data) {
      const productId = typeof item.price?.product === 'string'
        ? item.price.product
        : item.price?.product?.id;

      if (productId && config.stripe.productIds.includes(productId)) {
        return true;
      }
    }

    console.log(`[Stripe] Session ${session.id} skipped — no matching product IDs (found: ${lineItems.data.map(i => typeof i.price?.product === 'string' ? i.price.product : i.price?.product?.id).join(', ')})`);
    return false;
  } catch (err) {
    console.error('[Stripe] Failed to check line items:', err);
    // If we can't check, default to NOT tracking (safer for shared accounts)
    return false;
  }
}

// Check if a charge belongs to a tracked product (for refunds)
async function isTrackedCharge(charge: Stripe.Charge): Promise<boolean> {
  if (config.stripe.productIds.length === 0) return true;

  try {
    const stripe = getStripe();
    // Get the payment intent to find the checkout session
    if (charge.payment_intent) {
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent.id;
      // Search for checkout sessions with this payment intent
      const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
      if (sessions.data.length > 0) {
        return isTrackedProduct(sessions.data[0]);
      }
    }
    return false;
  } catch (err) {
    console.error('[Stripe] Failed to check charge product:', err);
    return false;
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
      // Check if this is one of our products
      const tracked = await isTrackedProduct(session);
      if (!tracked) {
        console.log(`[Stripe] Ignoring purchase from ${email} — not a tracked product`);
        res.json({ received: true });
        return;
      }

      const subscriber = await getSubscriberByEmail(email);
      // Look up which email in the sequence triggered this purchase
      let emailSource: string | undefined;
      if (subscriber?.visitor_id) {
        emailSource = (await getLatestEmailSource(subscriber.visitor_id)) || undefined;
      }
      await insertPurchase({
        email,
        amount_cents: amount,
        currency,
        stripe_session_id: session.id,
        utm_campaign: subscriber?.utm_campaign || undefined,
        utm_source: subscriber?.utm_source || undefined,
        purchased_at: new Date(session.created * 1000).toISOString(),
        email_source: emailSource,
      });
      console.log(`[Stripe] Purchase recorded: ${email} | $${(amount / 100).toFixed(2)} | campaign=${subscriber?.utm_campaign || 'unknown'} | email_source=${emailSource || 'direct'}`);
    }
  }

  // Handle charge.refunded
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const email = charge.billing_details?.email || charge.receipt_email;
    const refundedAmount = charge.amount_refunded || 0;
    const currency = charge.currency || 'usd';

    if (email) {
      const tracked = await isTrackedCharge(charge);
      if (!tracked) {
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
      });
      console.log(`[Stripe] Refund recorded: ${email} | $${(refundedAmount / 100).toFixed(2)}`);
    }
  }

  res.json({ received: true });
});

export default router;
