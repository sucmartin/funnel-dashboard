import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config';
import { insertPurchase, getSubscriberByEmail } from '../db/queries';

const router = Router();

// POST /api/webhooks/stripe
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    console.warn('[Stripe] No webhook secret configured, skipping signature verification');
    res.status(400).json({ error: 'Webhook secret not configured' });
    return;
  }

  const stripe = new Stripe(config.stripe.secretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Stripe] Webhook signature verification failed:', message);
    res.status(400).json({ error: `Webhook Error: ${message}` });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_email || session.customer_details?.email;
    const amount = session.amount_total || 0;
    const currency = session.currency || 'usd';

    if (email) {
      const subscriber = await getSubscriberByEmail(email);

      await insertPurchase({
        email,
        amount_cents: amount,
        currency,
        stripe_session_id: session.id,
        utm_campaign: subscriber?.utm_campaign || undefined,
        utm_source: subscriber?.utm_source || undefined,
        purchased_at: new Date(session.created * 1000).toISOString(),
      });

      console.log(`[Stripe] Purchase recorded: ${email} | $${(amount / 100).toFixed(2)} | utm_campaign=${subscriber?.utm_campaign || 'unknown'}`);
    }
  }

  res.json({ received: true });
});

export default router;
