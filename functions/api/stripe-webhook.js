// POST /api/stripe-webhook
// Stripe calls this after a payment. We check the signature, then email the order details.
import { stripeRequest, verifyStripeSignature } from '../../server/stripe.js';
import { buildOrder, sendOrderEmail } from '../../server/order-email.js';

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text(); // must be the exact raw body for the signature check
  const signature = request.headers.get('stripe-signature');

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 500 });
  }
  if (!(await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  const event = JSON.parse(rawBody);
  if (event.type !== 'checkout.session.completed') {
    return new Response(`Ignored ${event.type}`, { status: 200 });
  }

  const session = event.data.object;
  let order;
  try {
    const lineItems = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(session.id)}/line_items`, { limit: 100 });
    order = buildOrder(session, lineItems.data);
  } catch (err) {
    console.error('Could not load order details:', err.message);
    return new Response('Could not load order', { status: 500 }); // Stripe will retry
  }

  // Always log the order, so it is visible in Cloudflare's logs even if email fails.
  console.log('NEW ORDER', JSON.stringify(order));

  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not set — order email not sent (order is logged above and in Stripe).');
    return new Response('OK (no email configured)', { status: 200 });
  }
  try {
    await sendOrderEmail(env, order);
  } catch (err) {
    console.error('Order email failed:', err.message);
    return new Response('Email failed', { status: 500 }); // Stripe will retry, Resend de-duplicates
  }
  return new Response('OK', { status: 200 });
}
