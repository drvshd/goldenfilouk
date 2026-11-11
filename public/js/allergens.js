// Allergens page: lists every product's allergens from /data/products.json.
import { loadShopData, escapeHtml as esc } from './site.js';

const root = document.getElementById('allergenRoot');

loadShopData()
  .then(({ catalogue }) => {
    root.innerHTML = catalogue.categories
      .map((cat) => {
        const products = catalogue.products.filter((p) => p.category === cat.id);
        if (!products.length) return '';
        return `
          <h2>${esc(cat.name)}</h2>
          <table class="allergen-table">
            <thead><tr><th>Product</th><th>Allergens</th></tr></thead>
            <tbody>
              ${products.map((p) => `<tr id="${esc(p.id)}"><td>${esc(p.name)}</td><td>${esc(p.allergens || 'TBC')}</td></tr>`).join('')}
            </tbody>
          </table>`;
      })
      .join('');
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  })
  .catch((err) => {
    console.error(err);
    root.innerHTML = '<div class="notice error">Sorry, the allergen list could not be loaded. Please refresh the page or contact us.</div>';
  });
