// Unit tests for the pure logic. Run with: node tests/unit.mjs
import assert from 'node:assert/strict';
import { fmtRs, waDigits, displayPhone, slugify } from '../js/util.js';
import { normalize, unitPrice, minQtyFor, searchProducts, isOrderable } from '../js/catalog.js';
import { Cart, resolveLines } from '../js/cart.js';
import { validateCheckout, buildMessage, waLink } from '../js/whatsapp.js';
import { seal, unseal } from '../admin/vault.js';

let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('  ok -', name); };

const catalog = normalize({
  categories: [{ id: 'mugs', name: 'Mugs' }],
  products: [
    { code: 'MG-001', name: 'Magic Mug', categoryId: 'mugs', price: 1500, stock: 'in_stock' },
    { code: 'POL', name: 'Polaroid', customPrint: true, price: null, stock: 'made_to_order',
      options: [{ id: 'mini', label: 'Mini', size: '2x3 in', price: 50, minQty: 10 }, { id: 'large', label: 'Large', price: null, minQty: 1 }] },
    { code: 'OUT-1', name: 'Gone', price: 100, stock: 'out_of_stock' },
    { code: 'HID-1', name: 'Hidden', price: 100, active: false },
  ],
});

await t('currency formatting', () => {
  assert.equal(fmtRs(1500), 'Rs. 1,500');
  assert.equal(fmtRs(1500.5), 'Rs. 1,500.50');
  assert.equal(fmtRs(null), null);
});
await t('phone helpers', () => {
  assert.equal(waDigits('+94 74 289 9909'), '94742899909');
  assert.equal(waDigits('0742899909'), '94742899909');
  assert.equal(displayPhone('94742899909'), '+94 74 289 9909');
  assert.equal(slugify('Photo Collages!'), 'photo-collages');
});
await t('catalogue helpers: price, min qty, search, stock', () => {
  const pol = catalog.products[1];
  assert.equal(unitPrice(pol, 'mini'), 50);
  assert.equal(unitPrice(pol, 'large'), null);
  assert.equal(minQtyFor(pol, 'mini'), 10);
  assert.equal(searchProducts(catalog, { q: 'mg-001' }).length, 1);
  assert.equal(searchProducts(catalog, { q: 'magic' }).length, 1);
  assert.equal(searchProducts(catalog, { q: 'hidden' }).length, 0);
  assert.equal(searchProducts(catalog, { categoryId: 'mugs' }).length, 1);
  assert.equal(isOrderable(catalog.products[2]), false);
});
await t('cart merges lines, clamps and resolves from live catalogue', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const cart = new Cart(storage);
  cart.add('MG-001', '', 2);
  cart.add('MG-001', '', 1);
  cart.add('POL', 'mini', 10);
  cart.add('OUT-1', '', 1);
  assert.equal(cart.count(), 14);
  const reloaded = new Cart(storage);
  assert.equal(reloaded.items().length, 3);
  const r = resolveLines(catalog, reloaded.items());
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.dropped, ['OUT-1']);
  assert.equal(r.subtotal, 1500 * 3 + 500);
  assert.equal(r.lines[1].optionLabel, 'Mini (2x3 in)');
  cart.setQty('POL|mini', 3);
  assert.equal(resolveLines(catalog, cart.items()).belowMin, 1);
});
await t('checkout validation', () => {
  const bad = validateCheckout({ name: '', phone: '123', address: '', city: '', postal: '' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['address', 'city', 'name', 'phone', 'postal']);
  assert.equal(validateCheckout({ name: 'Nimali Perera', phone: '077 123 4567', address: '12 Beach Road', city: 'Matara', postal: '81000' }).ok, true);
  assert.equal(validateCheckout({ name: 'Nimali Perera', phone: '+94771234567', address: '12 Beach Road', city: 'Matara', postal: '81000' }).ok, true);
});
await t('WhatsApp message and link', () => {
  const r = resolveLines(catalog, [{ code: 'MG-001', optionId: '', qty: 2 }, { code: 'POL', optionId: 'mini', qty: 10 }, { code: 'POL', optionId: 'large', qty: 1 }]);
  const msg = buildMessage({
    shopName: 'Mathaka Gift Shop',
    customer: { name: 'Nimali Perera', phone: '0771234567', address: '12 Beach Road', city: 'Matara', postal: '81000' },
    lines: r.lines, subtotal: r.subtotal, unpricedCount: r.unpricedCount, notes: 'Gift wrap please',
  });
  assert.match(msg, /^Hi Mathaka Gift Shop! I’d like to place an order\.\n\nCustomer name: Nimali Perera\nCustomer WhatsApp number: 0771234567\nDelivery address: 12 Beach Road, Matara\nPostal code: 81000\n\nItems:\n/);
  assert.match(msg, /1\. Magic Mug \| Code: MG-001 \| Option: - \| Qty: 2 \| Rs\. 3,000\n/);
  assert.match(msg, /2\. Polaroid \| Code: POL \| Option: Mini \(2x3 in\) \| Qty: 10 \| Rs\. 500\n/);
  assert.match(msg, /3\. Polaroid \| Code: POL \| Option: Large \| Qty: 1 \| Rs\. TBC/);
  assert.match(msg, /Product subtotal: Rs\. 3,500 \(excludes 1 item with price to be confirmed\)\nOrder notes: Gift wrap please$/);
  const url = waLink('94742899909', msg);
  assert.ok(url.startsWith('https://wa.me/94742899909?text='));
  assert.ok(!/[\n ]/.test(url));
  assert.equal(decodeURIComponent(url.split('?text=')[1]), msg);
});
await t('admin vault: wrong password is rejected, right one decrypts', async () => {
  const blob = await seal({ token: 'ghp_secret', owner: 'o' }, 'correct horse battery');
  assert.ok(!JSON.stringify(blob).includes('ghp_secret'));
  assert.deepEqual(await unseal(blob, 'correct horse battery'), { token: 'ghp_secret', owner: 'o' });
  await assert.rejects(() => unseal(blob, 'wrong password!!'));
});

console.log(`\n${passed} unit tests passed`);
