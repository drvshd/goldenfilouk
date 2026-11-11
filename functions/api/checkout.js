// POST /api/checkout
// Receives ONLY product ids + quantities from the browser. Prices, stock and limits come from
// products.json / shop-config.json on the server, then a Stripe Checkout Session is created.
import catalogue from '../../public/data/products.json';
import config from '../../public/data/shop-config.json';
import { priceBasket } from '../../public/js/pricing.js';
import { stripeRequest } from '../../server/stripe.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set');
    return json({ error: 'Online checkout is not available right now. Please order by WhatsApp.' }, 503);
  }

  if (Number(request.headers.get('content-length') || 0) > 20000) {
    return json({ error: 'Request too large.' }, 413);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // Keep only id + qty from each item — anything else the browser sends (e.g. a price) is ignored.
  const items = (Array.isArray(body && body.items) ? body.items : [])
    .slice(0, 100)
    .map((i) => ({ id: String((i && i.id) ?? ''), qty: Number(i && i.qty) }));

  const result = priceBasket(items, catalogue, config);
  if (!result.ok) {
    const problems = [
      ...result.problems,
      ...result.lines.filter((l) => l.problem).map((l) => `${l.product ? l.product.name : 'An item'}: ${l.problem}`),
    ];
    return json({ error: 'Please check your basket.', problems }, 400);
  }

  const origin = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
  const categories = new Map(catalogue.categories.map((c) => [c.id, c]));

  const line_items = result.lines.map((l) => {
    const p = l.product;
    const cat = categories.get(p.category) || {};
    const soldAs = cat.sold_as || 'box';
    const description = [soldAs === 'box' ? 'Box' : 'Tray', p.qty_per_box, p.weight].filter(Boolean).join(' · ');
    return {
      quantity: l.qty,
      price_data: {
        currency: 'gbp',
        unit_amount: l.unitPence,
        product_data: {
          name: cat.name ? `${p.name} (${cat.name})` : p.name,
          description,
          metadata: { product_id: p.id },
        },
      },
    };
  });

  const shipping_options = [];
  const delivery = config.delivery || {};
  if (delivery.enabled) {
    const rate = {
      type: 'fixed_amount',
      fixed_amount: { amount: result.deliveryPence, currency: 'gbp' },
      display_name: String(delivery.label || 'Delivery').slice(0, 100),
    };
    const min = Number(delivery.estimate_days_min);
    const max = Number(delivery.estimate_days_max);
    if (min > 0 && max >= min) {
      rate.delivery_estimate = {
        minimum: { unit: 'business_day', value: min },
        maximum: { unit: 'business_day', value: max },
      };
    }
    shipping_options.push({ shipping_rate_data: rate });
  }
  const collection = config.collection || {};
  if (collection.enabled) {
    const name = [collection.label || 'Collection', collection.address].filter(Boolean).join(' — ');
    shipping_options.push({
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 0, currency: 'gbp' },
        display_name: name.slice(0, 100),
      },
    });
  }

  const params = {
    mode: 'payment',
    payment_method_types: ['card'], // cards, incl. Apple Pay / Google Pay
    locale: 'en-GB',
    submit_type: 'pay',
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cancel`,
    line_items,
    shipping_address_collection: { allowed_countries: ['GB'] },
    phone_number_collection: { enabled: true },
    custom_fields: [
      {
        key: 'businessname',
        label: { type: 'custom', custom: 'Business name' },
        type: 'text',
        optional: true,
      },
      {
        key: 'deliverynotes',
        label: { type: 'custom', custom: 'Delivery notes' },
        type: 'text',
        optional: true,
      },
    ],
    custom_text: {
      submit: {
        message: 'Frozen goods: please make sure someone can receive your delivery. By paying you agree to our terms at goldenfilouk.com/terms.',
      },
    },
    metadata: {
      basket: result.lines.map((l) => `${l.id}:${l.qty}`).join(',').slice(0, 500),
    },
    payment_intent_data: { description: 'Golden Filo UK online order' },
  };
  if (shipping_options.length) params.shipping_options = shipping_options;

  try {
    const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', params);
    return json({ url: session.url });
  } catch (err) {
    console.error(err.message);
    return json({ error: 'Sorry, we could not start the checkout. Please try again, or order by WhatsApp.' }, 502);
  }
}
