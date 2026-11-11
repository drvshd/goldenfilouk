// Pricing rules shared by the browser (for display) and the server (/functions/api/checkout.js).
// The server's result is the one that is charged — the browser copy is only for showing totals.
// All money is handled in pence (whole numbers) to avoid rounding errors.

/** Pence for one "unit" of the price, e.g. £0.80 per piece → 80. */
export function unitPricePence(product) {
  return Math.round(Number(product.unit_price) * 100);
}

/** Price of one sellable item (a box, or a tray for Siropiasta). */
export function salePricePence(product) {
  return unitPricePence(product) * Math.max(1, Math.round(Number(product.units_per_box) || 1));
}

export function formatGBP(pence) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/** "£0.80/pc", "£11.00/tray", "£7.20/kg" */
export function formatUnitPrice(product) {
  return `${formatGBP(unitPricePence(product))}/${product.unit}`;
}

function poundsToPence(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * Checks a basket against the catalogue and shop settings and works out the totals.
 *
 * @param {{id:string, qty:number}[]} items   from the basket (ids + quantities only)
 * @param {object} catalogue                  contents of /data/products.json
 * @param {object} config                     contents of /data/shop-config.json
 */
export function priceBasket(items, catalogue, config) {
  const products = new Map(catalogue.products.map((p) => [p.id, p]));
  const categories = new Map(catalogue.categories.map((c) => [c.id, c]));
  const maxQty = Math.max(1, Number(config.max_qty_per_product) || 50);
  const problems = []; // basket-wide problems (strings)
  const lines = [];

  // Merge duplicate ids so nobody can bypass the per-product limit.
  const merged = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== 'string') continue;
    merged.set(item.id, (merged.get(item.id) || 0) + Number(item.qty));
  }

  for (const [id, rawQty] of merged) {
    const product = products.get(id);
    const line = { id, qty: rawQty, product, problem: null, unitPence: 0, totalPence: 0 };
    if (!product) {
      line.problem = 'This product is no longer available.';
    } else if (!Number.isInteger(rawQty) || rawQty < 1) {
      line.problem = 'Quantity must be a whole number of 1 or more.';
    } else if (rawQty > maxQty) {
      line.problem = `Maximum ${maxQty} per product online — contact us for larger orders.`;
    } else if (product.in_stock === false) {
      line.problem = 'Out of stock.';
    } else {
      line.unitPence = salePricePence(product);
      line.totalPence = line.unitPence * rawQty;
      line.soldAs = (categories.get(product.category) || {}).sold_as || 'box';
    }
    lines.push(line);
  }

  if (lines.length === 0) problems.push('Your basket is empty.');
  if (lines.length > 50) problems.push('Too many different products in one order.');

  const subtotalPence = lines.reduce((sum, l) => sum + l.totalPence, 0);

  const minimum = config.minimum_order || {};
  const minimumPence = minimum.enabled ? poundsToPence(minimum.amount) : 0;
  if (minimumPence && subtotalPence < minimumPence) {
    problems.push(`The minimum online order is ${formatGBP(minimumPence)} (before delivery).`);
  }

  const delivery = config.delivery || {};
  let deliveryPence = 0;
  if (delivery.enabled) {
    deliveryPence = poundsToPence(delivery.fee);
    const freeOver = poundsToPence(delivery.free_over);
    if (freeOver && subtotalPence >= freeOver) deliveryPence = 0;
  }

  const ok = problems.length === 0 && lines.every((l) => !l.problem);
  return {
    ok,
    lines,
    problems,
    subtotalPence,
    deliveryEnabled: !!delivery.enabled,
    deliveryPence,
    totalPence: subtotalPence + deliveryPence,
  };
}
