// Basket page: edit quantities, remove items, show totals, start Stripe Checkout.
import { basket, loadShopData, escapeHtml as esc } from './site.js';
import { priceBasket, formatGBP } from './pricing.js';

const root = document.getElementById('basketRoot');
const plural = (w) => (w === 'box' ? 'boxes' : `${w}s`);
let data = null;
let checkoutError = '';

function emptyHtml() {
  return `
    <p>Your basket is empty.</p>
    <div class="cta-row"><a class="btn btn-gold" href="/">Browse the catalogue</a></div>`;
}

function lineHtml(line, maxQty) {
  const p = line.product;
  if (!p) {
    return `
      <tr data-id="${esc(line.id)}">
        <td class="product"><span class="product-name">Unavailable product</span>
          <span class="line-problem">${esc(line.problem)}</span></td>
        <td class="num" data-label="Price">—</td>
        <td class="num" data-label="Quantity">—</td>
        <td class="price" data-label="Total">—</td>
        <td class="order"><button type="button" class="btn-link" data-remove>Remove</button></td>
      </tr>`;
  }
  const cat = data.catalogue.categories.find((c) => c.id === p.category) || {};
  const soldAs = cat.sold_as || 'box';
  const details = [cat.name, soldAs === 'box' ? 'Box' : 'Tray', p.qty_per_box, p.weight].filter(Boolean).join(' · ');
  return `
    <tr data-id="${esc(p.id)}">
      <td class="product">
        <span class="product-name">${esc(p.name)}</span>
        <span class="product-meta">${esc(details)}</span>
        ${line.problem ? `<span class="line-problem">${esc(line.problem)}</span>` : ''}
      </td>
      <td class="num" data-label="Price / ${esc(soldAs)}">${line.unitPence ? esc(formatGBP(line.unitPence)) : '—'}</td>
      <td class="num" data-label="Quantity">
        <div class="qty" role="group" aria-label="Number of ${esc(plural(soldAs))} of ${esc(p.name)}">
          <button type="button" data-step="-1" aria-label="One less">&minus;</button>
          <input type="number" inputmode="numeric" min="1" max="${maxQty}" step="1"
                 value="${esc(line.qty)}" aria-label="Quantity (${esc(plural(soldAs))})">
          <button type="button" data-step="1" aria-label="One more">+</button>
        </div>
      </td>
      <td class="price" data-label="Total">${line.totalPence ? esc(formatGBP(line.totalPence)) : '—'}</td>
      <td class="order"><button type="button" class="btn-link" data-remove aria-label="Remove ${esc(p.name)}">Remove</button></td>
    </tr>`;
}

function summaryHtml(result) {
  const { config } = data;
  let deliveryRow;
  if (result.deliveryEnabled) {
    const label = esc((config.delivery && config.delivery.label) || 'Delivery');
    deliveryRow = `<div class="summary-row"><span>${label}</span><span>${result.deliveryPence ? esc(formatGBP(result.deliveryPence)) : 'Free'}</span></div>`;
  } else {
    deliveryRow = `<div class="summary-row"><span>Delivery</span><span>To be arranged</span></div>`;
  }
  const problems = result.problems.filter((p) => p !== 'Your basket is empty.');
  const lineIssues = result.lines.some((l) => l.problem);
  return `
    <div class="summary">
      <div class="summary-row"><span>Subtotal</span><span>${esc(formatGBP(result.subtotalPence))}</span></div>
      ${deliveryRow}
      <div class="summary-row total"><span>Total</span><span>${esc(formatGBP(result.totalPence))}</span></div>
      ${problems.map((p) => `<div class="notice error">${esc(p)}</div>`).join('')}
      ${lineIssues ? '<div class="notice error">Please fix or remove the items marked above to continue.</div>' : ''}
      ${checkoutError ? `<div class="notice error" role="alert">${esc(checkoutError)}</div>` : ''}
      <p class="summary-note">You'll enter your delivery address and pay securely by card on Stripe's checkout page. See <a href="/delivery">delivery information</a>.</p>
      <div class="checkout-actions">
        <button type="button" class="btn btn-gold" id="checkoutBtn" ${result.ok ? '' : 'disabled'}>Checkout securely</button>
        <a class="btn btn-outline" href="/">Continue shopping</a>
      </div>
    </div>`;
}

function render() {
  if (!data) return;
  // Remember which control had focus so re-rendering doesn't lose the user's place.
  const active = document.activeElement;
  const focusRow = active && active.closest && active.closest('tr[data-id]');
  const focusKey = focusRow && (active.dataset.step ? `[data-step="${active.dataset.step}"]` : active.tagName === 'INPUT' ? 'input' : null);

  const items = basket.items();
  if (!items.length) {
    root.innerHTML = emptyHtml();
    return;
  }
  const maxQty = Math.max(1, Number(data.config.max_qty_per_product) || 50);
  const result = priceBasket(items, data.catalogue, data.config);
  root.innerHTML = `
    <table class="basket-table">
      <thead>
        <tr><th>Product</th><th class="num">Price</th><th class="num">Quantity</th><th class="price-col">Total</th><th><span class="visually-hidden">Remove</span></th></tr>
      </thead>
      <tbody>${result.lines.map((l) => lineHtml(l, maxQty)).join('')}</tbody>
    </table>
    ${summaryHtml(result)}`;

  if (focusRow && focusKey) {
    const row = root.querySelector(`tr[data-id="${CSS.escape(focusRow.dataset.id)}"]`);
    row?.querySelector(focusKey)?.focus();
  }
}

async function startCheckout(btn) {
  checkoutError = '';
  btn.disabled = true;
  btn.textContent = 'Taking you to secure checkout…';
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: basket.items() }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) {
      window.location.assign(body.url);
      return;
    }
    checkoutError = [body.error || 'Sorry, we could not start the checkout. Please try again.', ...(body.problems || [])].join(' ');
  } catch {
    checkoutError = 'Could not connect. Please check your internet connection and try again.';
  }
  render();
}

root.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row && e.target.closest('[data-remove]')) {
    basket.remove(row.dataset.id);
    return;
  }
  const step = e.target.closest('[data-step]');
  if (row && step) {
    const input = row.querySelector('input');
    const max = Number(input.max) || 50;
    const next = Math.min(max, (Math.floor(Number(input.value)) || 0) + Number(step.dataset.step));
    if (next >= 1) basket.set(row.dataset.id, next);
    return;
  }
  const btn = e.target.closest('#checkoutBtn');
  if (btn && !btn.disabled) startCheckout(btn);
});

root.addEventListener('change', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row || !e.target.matches('.qty input')) return;
  const max = Number(e.target.max) || 50;
  let q = Math.floor(Number(e.target.value));
  if (!Number.isFinite(q) || q < 1) q = 1;
  basket.set(row.dataset.id, Math.min(q, max));
});

window.addEventListener('basket:change', () => {
  checkoutError = '';
  render();
});
window.addEventListener('storage', () => render());
// Coming back from Stripe with the browser's Back button: re-enable the checkout button.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) render();
});

loadShopData()
  .then((d) => {
    data = d;
    render();
  })
  .catch((err) => {
    console.error(err);
    root.innerHTML = `<div class="notice error">Sorry, the basket could not be loaded. Please refresh the page.</div>`;
  });
