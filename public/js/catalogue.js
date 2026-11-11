// Builds the catalogue tables on the home page from /data/products.json.
import { basket, loadShopData, escapeHtml as esc } from './site.js';
import { salePricePence, formatGBP, formatUnitPrice } from './pricing.js';

const root = document.getElementById('catalogue');
const live = document.getElementById('basketLive');
const plural = (w) => (w === 'box' ? 'boxes' : `${w}s`);

function productRow(p, cat, cols, maxQty) {
  const soldAs = cat.sold_as || 'box';
  const out = p.in_stock === false;
  const meta = `<span class="product-meta">Allergens: <a href="/allergens#${esc(p.id)}">${esc(p.allergens || 'TBC')}</a></span>`;
  return `
    <tr data-id="${esc(p.id)}">
      <td class="product" data-label="Product">
        <span class="product-name">${esc(p.name)}</span>${out ? '<span class="stock-out">Out of stock</span>' : ''}
        ${meta}
      </td>
      ${cols.weight ? `<td class="num" data-label="Weight">${esc(p.weight || '—')}</td>` : ''}
      ${cols.qty ? `<td class="num" data-label="${esc(cat.qty_heading || 'Qty / box')}">${esc(p.qty_per_box || '—')}</td>` : ''}
      ${cols.unit ? `<td class="num" data-label="Price">${esc(formatUnitPrice(p))}</td>` : ''}
      <td class="price" data-label="Price / ${esc(soldAs)}">${esc(formatGBP(salePricePence(p)))}</td>
      <td class="order">
        <div class="order-controls">
          <div class="qty" role="group" aria-label="Number of ${esc(plural(soldAs))} of ${esc(p.name)}">
            <button type="button" data-step="-1" aria-label="One less" ${out ? 'disabled' : ''}>&minus;</button>
            <input type="number" inputmode="numeric" min="1" max="${maxQty}" step="1" value="1"
                   aria-label="Quantity (${esc(plural(soldAs))})" ${out ? 'disabled' : ''}>
            <button type="button" data-step="1" aria-label="One more" ${out ? 'disabled' : ''}>+</button>
          </div>
          <button type="button" class="btn btn-gold btn-small add-btn" ${out ? 'disabled' : ''}>
            ${out ? 'Unavailable' : 'Add to basket'}
          </button>
        </div>
      </td>
    </tr>`;
}

function categorySection(cat, products, index, maxQty) {
  const cols = {
    weight: products.some((p) => p.weight),
    qty: products.some((p) => p.qty_per_box),
    unit: products.some((p) => Number(p.units_per_box) > 1),
  };
  const soldAs = cat.sold_as || 'box';
  return `
    <section class="category${index % 2 === 0 ? ' alt' : ''}" id="${esc(cat.id)}">
      <div class="category-inner">
        <div class="cat-head">
          <h2>${esc(cat.name)}</h2>
          <span class="count">${products.length} product${products.length === 1 ? '' : 's'}</span>
        </div>
        <p class="cat-note">Sold by the ${esc(soldAs)}.${cat.note ? ' ' + esc(cat.note) : ''}</p>
        <table class="catalogue-table">
          <thead>
            <tr>
              <th>Product</th>
              ${cols.weight ? '<th class="num">Weight</th>' : ''}
              ${cols.qty ? `<th class="num">${esc(cat.qty_heading || 'Qty / box')}</th>` : ''}
              ${cols.unit ? '<th class="num">Price</th>' : ''}
              <th class="price-col">Price / ${esc(soldAs)}</th>
              <th class="num"><span class="visually-hidden">Order</span></th>
            </tr>
          </thead>
          <tbody>
            ${products.map((p) => productRow(p, cat, cols, maxQty)).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function clampQty(input) {
  const max = Number(input.max) || 50;
  let q = Math.floor(Number(input.value));
  if (!Number.isFinite(q) || q < 1) q = 1;
  if (q > max) q = max;
  input.value = String(q);
  return q;
}

function wireEvents(catalogue) {
  const byId = new Map(catalogue.products.map((p) => [p.id, p]));

  root.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const input = row.querySelector('input');

    const step = e.target.closest('[data-step]');
    if (step) {
      input.value = String((Math.floor(Number(input.value)) || 0) + Number(step.dataset.step));
      clampQty(input);
      return;
    }

    const add = e.target.closest('.add-btn');
    if (add) {
      const qty = clampQty(input);
      const p = byId.get(row.dataset.id);
      basket.add(row.dataset.id, qty);
      input.value = '1';
      add.textContent = 'Added ✓';
      add.classList.add('added');
      clearTimeout(add._t);
      add._t = setTimeout(() => {
        add.textContent = 'Add to basket';
        add.classList.remove('added');
      }, 1600);
      if (live && p) live.textContent = `Added ${qty} × ${p.name} to your basket.`;
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('.qty input')) clampQty(e.target);
  });
}

async function init() {
  if (!root) return;
  try {
    const { catalogue, config } = await loadShopData();
    const maxQty = Math.max(1, Number(config.max_qty_per_product) || 50);
    root.innerHTML = catalogue.categories
      .map((cat) => ({ cat, products: catalogue.products.filter((p) => p.category === cat.id) }))
      .filter((c) => c.products.length)
      .map((c, i) => categorySection(c.cat, c.products, i, maxQty))
      .join('');
    wireEvents(catalogue);
    // If the page was opened at e.g. /#siropiasta, scroll there now the section exists.
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (err) {
    console.error(err);
    root.innerHTML = `
      <section class="category"><div class="category-inner">
        <div class="notice error">Sorry, the catalogue could not be loaded. Please refresh the page,
        or order by WhatsApp on <a href="https://wa.me/447722008968">+44 7722 008968</a>.</div>
      </div></section>`;
  }
}

init();
