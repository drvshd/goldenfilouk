// After a successful Stripe payment: empty the basket and show the order reference.
import { basket } from './site.js';

const sessionId = new URLSearchParams(window.location.search).get('session_id');
if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
  basket.clear();
  const ref = document.getElementById('orderRef');
  // Same reference format as the order notification email (see server/stripe.js).
  if (ref) ref.textContent = ` — order reference ${sessionId.slice(-8).toUpperCase()}`;
}
