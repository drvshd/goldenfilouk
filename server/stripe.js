// Minimal Stripe helpers for Cloudflare Pages Functions — no npm packages needed.
// Lives outside /functions so it is never treated as a web route.

/** Turns a nested object into Stripe's form encoding: a[b][0][c]=value */
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** Calls the Stripe API. Throws on any non-2xx response. */
export async function stripeRequest(env, method, path, params) {
  const url = new URL(`https://api.stripe.com${path}`);
  const init = {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  };
  if (params && method === 'GET') {
    url.search = formEncode(params).toString();
  } else if (params) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = formEncode(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || res.statusText;
    throw new Error(`Stripe ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

const enc = new TextEncoder();

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.rawBody").
 * Rejects events older than `toleranceSec` to block replays.
 */
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s && s.trim());
    if (k === 't') timestamp = v;
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSec) return false;

  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => timingSafeEqual(s, expected));
}

/** Short reference shown to the customer on the success page and in the order email. */
export function orderRef(sessionId) {
  return String(sessionId).slice(-8).toUpperCase();
}
