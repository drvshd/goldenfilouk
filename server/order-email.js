// Builds and sends the "new order" notification email (via Resend — https://resend.com).
import { orderRef } from './stripe.js';

const money = (pence) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((Number(pence) || 0) / 100);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatAddress(a) {
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ');
}

/** Pulls everything we need out of a Checkout Session + its line items. */
export function buildOrder(session, lineItems) {
  const customer = session.customer_details || {};
  // Newer Stripe API versions move shipping details under collected_information.
  const shipping = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || {};
  const field = (key) => {
    const f = (session.custom_fields || []).find((x) => x.key === key);
    return (f && f.text && f.text.value) || '';
  };
  const live = !!session.livemode;
  return {
    ref: orderRef(session.id),
    sessionId: session.id,
    live,
    paid: session.payment_status === 'paid',
    paymentStatus: session.payment_status,
    created: new Date((session.created || Date.now() / 1000) * 1000).toLocaleString('en-GB', { timeZone: 'Europe/London' }),
    name: shipping.name || customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    business: field('businessname'),
    notes: field('deliverynotes'),
    address: formatAddress(shipping.address || customer.address),
    items: (lineItems || []).map((li) => ({
      name: li.description,
      qty: li.quantity,
      total: li.amount_total,
    })),
    subtotal: session.amount_subtotal,
    delivery: session.shipping_cost ? session.shipping_cost.amount_total : 0,
    total: session.amount_total,
    dashboardUrl: session.payment_intent
      ? `https://dashboard.stripe.com/${live ? '' : 'test/'}payments/${session.payment_intent}`
      : `https://dashboard.stripe.com/${live ? '' : 'test/'}payments`,
  };
}

export function orderEmail(order) {
  const subject = `${order.live ? '' : '[TEST] '}New order ${order.ref} — ${money(order.total)} — ${order.business || order.name}`;
  const rows = [
    ['Order ref', order.ref],
    ['Placed', order.created],
    ['Payment', order.paid ? 'PAID' : `NOT PAID (${order.paymentStatus})`],
    ['Name', order.name],
    ['Business', order.business],
    ['Phone', order.phone],
    ['Email', order.email],
    ['Deliver to', order.address],
    ['Delivery notes', order.notes],
  ].filter(([, v]) => v);

  const text = [
    subject,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Items:',
    ...order.items.map((i) => `  ${i.qty} × ${i.name} — ${money(i.total)}`),
    '',
    `Subtotal: ${money(order.subtotal)}`,
    `Delivery: ${money(order.delivery)}`,
    `TOTAL PAID: ${money(order.total)}`,
    '',
    `View in Stripe: ${order.dashboardUrl}`,
  ].join('\n');

  const td = 'padding:6px 10px;border-bottom:1px solid #E7E0CC;';
  const html = `
<div style="font-family:Arial,sans-serif;color:#2A2A28;max-width:640px">
  <h2 style="color:#14213D;margin:0 0 12px">${order.live ? '' : '[TEST] '}New order ${esc(order.ref)}</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
    ${rows.map(([k, v]) => `<tr><td style="${td}font-weight:bold;width:140px">${esc(k)}</td><td style="${td}">${esc(v)}</td></tr>`).join('')}
  </table>
  <table style="border-collapse:collapse;width:100%">
    <tr style="background:#14213D;color:#fff"><th style="padding:8px 10px;text-align:left">Item</th><th style="padding:8px 10px;text-align:right">Qty</th><th style="padding:8px 10px;text-align:right">Total</th></tr>
    ${order.items.map((i) => `<tr><td style="${td}">${esc(i.name)}</td><td style="${td}text-align:right">${esc(i.qty)}</td><td style="${td}text-align:right">${esc(money(i.total))}</td></tr>`).join('')}
    <tr><td style="${td}" colspan="2">Subtotal</td><td style="${td}text-align:right">${esc(money(order.subtotal))}</td></tr>
    <tr><td style="${td}" colspan="2">Delivery</td><td style="${td}text-align:right">${esc(money(order.delivery))}</td></tr>
    <tr><td style="padding:8px 10px;font-weight:bold" colspan="2">TOTAL PAID</td><td style="padding:8px 10px;text-align:right;font-weight:bold">${esc(money(order.total))}</td></tr>
  </table>
  <p style="margin-top:18px"><a href="${esc(order.dashboardUrl)}" style="color:#A9822A">View this payment in Stripe</a></p>
</div>`;
  return { subject, text, html };
}

export async function sendOrderEmail(env, order) {
  const { subject, text, html } = orderEmail(order);
  const payload = {
    from: env.ORDER_EMAIL_FROM || 'Golden Filo Orders <onboarding@resend.dev>',
    to: (env.ORDER_EMAIL_TO || 'goldenfilouk@gmail.com').split(',').map((s) => s.trim()).filter(Boolean),
    subject,
    text,
    html,
  };
  if (order.email) payload.reply_to = order.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // Stripe can resend the same event; this stops duplicate emails for 24h.
      'Idempotency-Key': `order-${order.sessionId}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
  }
}
