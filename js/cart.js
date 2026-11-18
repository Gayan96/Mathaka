// Shopping cart. Only item references (code, option, quantity) are kept, in this
// browser's localStorage. Prices always come from the live catalogue. No customer
// or delivery details are ever stored.
import { findProduct, findOption, unitPrice, minQtyFor, isOrderable } from './catalog.js';

const KEY = 'mathaka_cart_v1';

export class Cart {
  constructor(storage) {
    this.storage = storage || null;
    this.list = [];
    try {
      const raw = this.storage && this.storage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        this.list = parsed.filter((i) => i && typeof i.code === 'string' && Number.isFinite(i.qty) && i.qty > 0)
          .map((i) => ({ code: i.code, optionId: i.optionId || '', qty: Math.floor(i.qty) }));
      }
    } catch { this.list = []; }
  }

  save() {
    try { this.storage && this.storage.setItem(KEY, JSON.stringify(this.list)); } catch { /* storage blocked: keep in memory */ }
  }

  items() { return this.list.map((i) => ({ ...i })); }
  count() { return this.list.reduce((n, i) => n + i.qty, 0); }
  key(i) { return `${i.code}|${i.optionId || ''}`; }

  add(code, optionId, qty) {
    const q = Math.max(1, Math.floor(qty) || 1);
    const existing = this.list.find((i) => i.code === code && (i.optionId || '') === (optionId || ''));
    if (existing) existing.qty += q; else this.list.push({ code, optionId: optionId || '', qty: q });
    this.save();
  }

  setQty(key, qty) {
    const item = this.list.find((i) => this.key(i) === key);
    if (!item) return;
    item.qty = Math.max(1, Math.floor(qty) || 1);
    this.save();
  }

  remove(key) { this.list = this.list.filter((i) => this.key(i) !== key); this.save(); }
  clear() { this.list = []; this.save(); }
}

/**
 * Turn item references into priced lines using the live catalogue.
 * Returns { lines, subtotal, unpricedCount, dropped, belowMin }.
 */
export function resolveLines(catalog, items) {
  const lines = [];
  const dropped = [];
  let subtotal = 0;
  let unpricedCount = 0;
  let belowMin = 0;
  for (const it of items) {
    const product = findProduct(catalog, it.code);
    const option = findOption(product, it.optionId);
    if (!product || !product.active || !isOrderable(product) || (it.optionId && !option)) {
      dropped.push(it.code);
      continue;
    }
    const unit = unitPrice(product, it.optionId);
    const minQty = minQtyFor(product, it.optionId);
    const total = unit === null ? null : unit * it.qty;
    if (total === null) unpricedCount += 1; else subtotal += total;
    if (it.qty < minQty) belowMin += 1;
    lines.push({
      key: `${it.code}|${it.optionId || ''}`,
      code: product.code,
      name: product.name,
      optionId: it.optionId || '',
      optionLabel: option ? (option.size ? `${option.label} (${option.size})` : option.label) : '',
      qty: it.qty,
      minQty,
      unit,
      total,
      product,
    });
  }
  return { lines, subtotal, unpricedCount, dropped, belowMin };
}
