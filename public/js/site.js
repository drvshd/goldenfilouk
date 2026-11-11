// Shared on every page: basket storage, header basket count, mobile menu.
// The basket only stores product ids and box quantities — never prices.
// Prices are always looked up from /data/products.json (and on the server at checkout).

const STORAGE_KEY = 'gf_basket_v1';
let memoryBasket = {}; // fallback when localStorage is blocked (private mode, etc.)

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { ...memoryBasket };
  }
}

function writeStore(items) {
  memoryBasket = { ...items };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — basket lasts for this page only */
  }
  window.dispatchEvent(new CustomEvent('basket:change'));
}

function cleanQty(n) {
  const q = Math.floor(Number(n));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

export const basket = {
  /** @returns {{id:string, qty:number}[]} */
  items() {
    return Object.entries(readStore())
      .map(([id, qty]) => ({ id, qty: cleanQty(qty) }))
      .filter((i) => i.qty > 0);
  },
  count() {
    return this.items().reduce((sum, i) => sum + i.qty, 0);
  },
  add(id, qty = 1) {
    const items = readStore();
    items[id] = cleanQty(items[id]) + cleanQty(qty);
    writeStore(items);
  },
  set(id, qty) {
    const items = readStore();
    const q = cleanQty(qty);
    if (q > 0) items[id] = q;
    else delete items[id];
    writeStore(items);
  },
  remove(id) {
    const items = readStore();
    delete items[id];
    writeStore(items);
  },
  clear() {
    writeStore({});
  },
};

function updateBadges() {
  const n = basket.count();
  document.querySelectorAll('[data-basket-count]').forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll('[data-basket-link]').forEach((el) => {
    el.setAttribute('aria-label', n ? `Basket, ${n} box${n === 1 ? '' : 'es'}` : 'Basket, empty');
  });
}

window.addEventListener('basket:change', updateBadges);
// Keep the badge in sync when the basket changes in another tab.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) updateBadges();
});

function setupNav() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

updateBadges();
setupNav();

// ---- Shared helpers for catalogue / basket pages ----

let dataPromise;
/** Loads products + shop settings once per page. */
export function loadShopData() {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetch('/data/products.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error('Could not load products');
        return r.json();
      }),
      fetch('/data/shop-config.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error('Could not load shop settings');
        return r.json();
      }),
    ]).then(([catalogue, config]) => ({ catalogue, config }));
  }
  return dataPromise;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
