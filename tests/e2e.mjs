// End-to-end test in a real browser (Playwright + Chromium).
//   NODE_PATH=$(npm root -g) node tests/e2e.mjs
// A small local server plays two roles: the "website host" (serves the files) and a mock of
// the GitHub contents API. Saving in the admin writes into the served copy, which stands in for
// "GitHub commit + host redeploy". It is not the real GitHub, so see the README for the live check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'mathaka-e2e-'));
const SITE = path.join(OUT, 'site');
fs.cpSync(ROOT, SITE, { recursive: true, filter: (s) => !/[\\/](tests|node_modules|\.git)([\\/]|$)/.test(s) });

const TOKEN = 'test-token-ABC123';
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const commits = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' });
    const m = /^\/api\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/.exec(url.pathname);
    if (!m) return send(404, { message: 'Not Found' });
    if (m[1] !== 'mathaka' || m[2] !== 'shop') return send(404, { message: 'Not Found' });
    if (!m[3]) return send(200, { full_name: 'mathaka/shop' });
    const rel = decodeURIComponent(m[3]);
    const file = path.join(SITE, rel);
    if (!file.startsWith(SITE)) return send(400, {});
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return send(404, { message: 'Not Found' });
      const buf = fs.readFileSync(file);
      return send(200, { type: 'file', sha: gitSha(buf), content: buf.toString('base64').replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const j = JSON.parse(body);
        const exists = fs.existsSync(file);
        if (exists && gitSha(fs.readFileSync(file)) !== j.sha) return send(409, { message: 'sha does not match' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const buf = Buffer.from(j.content, 'base64');
        fs.writeFileSync(file, buf);
        commits.push({ path: rel, message: j.message });
        send(200, { content: { sha: gitSha(buf) } });
      });
      return undefined;
    }
    return send(405, {});
  }
  const p = path.join(SITE, url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(404, 'not found', 'text/plain');
  return send(200, fs.readFileSync(p), MIME[path.extname(p)] || 'application/octet-stream');
});
await new Promise((r) => server.listen(PORT, r));

const sampleImg = async (name, color, w = 900, h = 700) => {
  const f = path.join(OUT, name);
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(f);
  return f;
};
const catalogOnDisk = () => JSON.parse(fs.readFileSync(path.join(SITE, 'data/catalog.json'), 'utf8'));

let step = 0;
const ok = (m) => { step += 1; console.log(`  ok ${String(step).padStart(2)} - ${m}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const errors = [];
const watch = (page) => { page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); }); };

try {
  /* ===== OWNER: connect + add a product, banner, top product ===== */
  const admin = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  watch(admin);
  await admin.goto(`${BASE}/admin/`);
  await admin.fill('input[name=owner]', 'mathaka');
  await admin.fill('input[name=repo]', 'shop');
  await admin.fill('input[name=token]', TOKEN);
  await admin.fill('input[name=password]', 'short');
  await admin.fill('input[name=password2]', 'short');
  await admin.click('summary:has-text("Advanced")');
  await admin.fill('input[name=apiBase]', `${BASE}/api`);
  await admin.click('#setup-form button');
  assert.match(await admin.textContent('#auth-error'), /at least 10/);
  await admin.fill('input[name=password]', 'correct horse 42');
  await admin.fill('input[name=password2]', 'correct horse 42');
  await admin.click('#setup-form button');
  await admin.waitForSelector('#savebar');
  ok('admin setup rejects weak password, then connects to the repository');

  const vault = await admin.evaluate(() => localStorage.getItem('mathaka_admin_vault_v1'));
  assert.ok(vault && !vault.includes(TOKEN), 'token must not be stored in plain text');
  ok('GitHub token is stored encrypted, not in plain text');

  await admin.click('[data-act=new-product]');
  await admin.fill('[data-f=name]', 'Magic Photo Mug');
  assert.equal(await admin.inputValue('[data-f=code]'), 'MG-001');
  await admin.selectOption('[data-f=categoryId]', 'mugs');
  await admin.fill('[data-f=price]', '1650');
  await admin.fill('[data-f=description]', 'Colour-changing mug with your photo.');
  await admin.click('[data-act=opt-add]');
  await admin.click('[data-act=opt-add]');
  await admin.fill('[data-o=label][data-i="0"]', '11oz');
  await admin.fill('[data-o=price][data-i="0"]', '1650');
  await admin.fill('[data-o=label][data-i="1"]', '15oz');
  await admin.fill('[data-o=price][data-i="1"]', '1950');
  await admin.fill('[data-o=minQty][data-i="1"]', '2');
  await admin.setInputFiles('#pimg', [await sampleImg('mug1.png', '#d6000f'), await sampleImg('mug2.png', '#111111')]);
  await admin.waitForSelector('.img-cell >> nth=1');
  await admin.click('[data-act=img-main][data-i="1"]');
  await admin.click('[data-act=product-done]');
  await admin.click('#save-btn');
  await admin.waitForFunction(() => /Saved at/.test(document.getElementById('savebar').textContent));
  const saved = catalogOnDisk().products.find((p) => p.code === 'MG-001');
  assert.ok(saved, 'product saved to catalogue file');
  assert.equal(saved.name, 'Magic Photo Mug');
  assert.equal(saved.options.length, 2);
  assert.equal(saved.images.length, 2);
  const mainBytes = fs.readFileSync(path.join(SITE, saved.images[0]));
  assert.equal(mainBytes[0], 0xff); assert.equal(mainBytes[1], 0xd8);
  ok('product added from the dashboard and committed (catalogue + 2 optimised images)');

  // duplicate code is rejected
  await admin.click('[data-act=new-product]');
  await admin.fill('[data-f=name]', 'Dup');
  await admin.fill('[data-f=code]', 'mg-001');
  await admin.click('[data-act=product-done]');
  assert.match(await admin.textContent('#pform-error'), /already used/);
  await admin.click('[data-act=product-cancel]');
  ok('duplicate item codes are rejected');

  // bad upload is rejected
  await admin.click('[data-act=new-product]');
  fs.writeFileSync(path.join(OUT, 'fake.png'), 'not an image');
  await admin.setInputFiles('#pimg', path.join(OUT, 'fake.png'));
  await admin.waitForSelector('#toast.err');
  await admin.click('[data-act=product-cancel]');
  ok('non-image uploads are rejected');

  await admin.click('[data-tab=top]');
  await admin.selectOption('#top-add', 'MG-001');
  await admin.click('[data-act=top-add]');
  await admin.click('[data-tab=banners]');
  await admin.click('[data-act=b-add]');
  await admin.fill('[data-b=title][data-i="0"]', 'Mother’s Day Gifts');
  await admin.fill('[data-b=subtitle][data-i="0"]', 'Personalised photo gifts');
  await admin.fill('[data-b=buttonText][data-i="0"]', 'Shop now');
  await admin.fill('[data-b=link][data-i="0"]', '#/shop');
  await admin.setInputFiles('[data-banner-file="0"]', await sampleImg('banner1.png', '#8a0010', 1600, 700));
  await admin.waitForSelector('.banner-img[src^=blob]');
  await admin.click('#save-btn');
  await admin.waitForFunction(() => /Saved at/.test(document.getElementById('savebar').textContent));
  const cat1 = catalogOnDisk();
  assert.deepEqual(cat1.topProducts, ['MG-001']);
  assert.equal(cat1.banners.length, 1);
  assert.ok(fs.existsSync(path.join(SITE, cat1.banners[0].image)));
  ok('top product chosen and promotional banner published');

  /* ===== CUSTOMER (phone) ===== */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const shop = await ctx.newPage();
  watch(shop);
  await shop.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; });
  await shop.goto(`${BASE}/`);
  await shop.waitForSelector('.hero');
  assert.match(await shop.textContent('.slide.on'), /Mother’s Day Gifts/);
  assert.match(await shop.textContent('.cat-grid'), /Mugs/);
  assert.match(await shop.textContent('.grid'), /Magic Photo Mug/);
  assert.match(await shop.textContent('.polaroid-feature'), /Custom Polaroid Photo Prints/);
  assert.equal(await shop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll on mobile');
  assert.ok(await shop.locator('.wa-float').getAttribute('href').then((h) => h.startsWith('https://wa.me/94742899909')));
  assert.ok(await shop.locator('.site-footer a[href*=facebook]').count());
  await shop.screenshot({ path: path.join(OUT, 'shop-home-mobile.png'), fullPage: true });
  ok('home page shows the new banner, categories, top product, Polaroid section, WhatsApp + Facebook links');

  await shop.fill('#search-input', 'mg-001');
  await shop.press('#search-input', 'Enter');
  await shop.waitForSelector('.product-card');
  assert.equal(await shop.locator('.product-card').count(), 1);
  await shop.fill('#search-input', 'nothing-here');
  await shop.press('#search-input', 'Enter');
  assert.match(await shop.textContent('.empty'), /No products match/);
  await shop.goto(`${BASE}/#/shop?cat=mugs`);
  assert.equal(await shop.locator('.product-card').count(), 1);
  await shop.goto(`${BASE}/#/shop?cat=gift-items`);
  assert.equal(await shop.locator('.product-card').count(), 0);
  ok('search by item code and category filter work');

  await shop.goto(`${BASE}/#/product/MG-001`);
  await shop.waitForSelector('.product h1');
  assert.match(await shop.textContent('.info'), /Item code: MG-001/);
  assert.match(await shop.textContent('.info'), /In stock/);
  await shop.locator('label.opt', { hasText: '15oz' }).click();
  assert.equal(await shop.inputValue('#qty'), '2');
  await shop.fill('#qty', '1');
  await shop.click('[data-action=add]');
  assert.match(await shop.textContent('#buy-error'), /minimum order .* is 2/);
  await shop.fill('#qty', '3');
  assert.match(await shop.textContent('#pprice'), /Rs\. 1,950 × 3 = Rs\. 5,850/);
  await shop.click('[data-action=add]');
  assert.equal(await shop.textContent('#cart-count'), '3');
  ok('product page enforces option minimum quantity and adds to cart');

  // Polaroid: details visible before adding; unset price handled
  await shop.goto(`${BASE}/#/product/POLAROID-PRINT`);
  const polText = await shop.textContent('.info');
  for (const w of ['Mini', 'Large', 'Strip', 'Classic', 'Price on request', 'Minimum order', 'same chat']) assert.ok(polText.includes(w), `Polaroid page shows ${w}`);
  await shop.locator('label.opt', { hasText: 'Strip' }).click();
  await shop.click('[data-action=add]');
  assert.equal(await shop.textContent('#cart-count'), '4');
  ok('Polaroid options (Mini/Large/Strip/Classic) show size, price and minimum before adding');

  // Cart -> checkout -> validation
  await shop.goto(`${BASE}/#/cart`);
  assert.match(await shop.textContent('.cart-list'), /Magic Photo Mug/);
  assert.match(await shop.textContent('.summary'), /Product subtotal: Rs\. 5,850/);
  await shop.click('text=Checkout');
  await shop.waitForSelector('#co-form');
  await shop.click('#go-wa');
  assert.equal(await shop.evaluate(() => window.__opened.length), 0, 'WhatsApp must not open with missing details');
  for (const id of ['name', 'phone', 'address', 'city', 'postal']) assert.equal(await shop.locator(`#e-${id}`).isVisible(), true, `${id} error shown`);
  ok('checkout validates required fields before opening WhatsApp');

  await shop.fill('#f-name', 'Nimali Perera');
  await shop.fill('#f-phone', '077 123 4567');
  await shop.fill('#f-address', '12 Beach Road, Dondra');
  await shop.fill('#f-city', 'Matara');
  await shop.fill('#f-postal', '81000');
  await shop.fill('#f-notes', 'Please gift wrap & add a card');
  await shop.click('#go-wa');
  const opened = await shop.evaluate(() => window.__opened);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith('https://wa.me/94742899909?text='));
  assert.ok(!/[ \n]/.test(opened[0]), 'link is URL-encoded');
  const msg = decodeURIComponent(opened[0].split('?text=')[1]);
  const expected = [
    'Hi Mathaka Gift Shop! I’d like to place an order.', '',
    'Customer name: Nimali Perera', 'Customer WhatsApp number: 077 123 4567',
    'Delivery address: 12 Beach Road, Dondra, Matara', 'Postal code: 81000', '',
    'Items:',
    '1. Magic Photo Mug | Code: MG-001 | Option: 15oz | Qty: 3 | Rs. 5,850',
    '2. Custom Polaroid Photo Prints | Code: POLAROID-PRINT | Option: Strip | Qty: 1 | Rs. TBC (price to be confirmed)', '',
    'Product subtotal: Rs. 5,850 (excludes 1 item with price to be confirmed)',
    'Order notes: Please gift wrap & add a card',
  ].join('\n');
  assert.equal(msg, expected);
  ok('WhatsApp link opens business number with the exact message (item, code, option, qty, WhatsApp no., address, postal)');

  const body = await shop.textContent('body');
  assert.ok(!/order (sent|confirmed|placed)/i.test(body), 'no success wording');
  assert.match(await shop.textContent('#wa-help'), /Tap Send inside WhatsApp/);
  assert.match(await shop.textContent('#wa-help'), /not sent yet/);
  await shop.goto(`${BASE}/#/cart`);
  assert.equal(await shop.textContent('#cart-count'), '4');
  ok('no “order sent” message is shown, and the cart is kept after opening WhatsApp');

  await shop.goto(`${BASE}/#/checkout`);
  await shop.fill('#f-name', 'Nimali Perera'); await shop.fill('#f-phone', '+94771234567');
  await shop.fill('#f-address', '12 Beach Road'); await shop.fill('#f-city', 'Matara'); await shop.fill('#f-postal', '81000');
  await shop.click('#copy-msg');
  await shop.waitForSelector('#wa-help:not([hidden])');
  const clip = await shop.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^Hi Mathaka Gift Shop! I’d like to place an order\./);
  assert.match(clip, /Customer WhatsApp number: \+94771234567/);
  assert.match(await shop.textContent('#wa-help'), /Message copied/);
  ok('“Copy message” copies the same order text for manual pasting');

  // Direct order from product page (cart untouched)
  await shop.goto(`${BASE}/#/product/MG-001`);
  await shop.click('[data-action=direct]');
  await shop.waitForSelector('#co-form');
  assert.match(await shop.textContent('.callout'), /only this item/);
  await shop.fill('#f-name', 'Kasun Silva'); await shop.fill('#f-phone', '0712345678');
  await shop.fill('#f-address', '5 Temple Lane'); await shop.fill('#f-city', 'Galle'); await shop.fill('#f-postal', '80000');
  await shop.evaluate(() => { window.__opened = []; });
  await shop.click('#go-wa');
  const m2 = decodeURIComponent((await shop.evaluate(() => window.__opened))[0].split('?text=')[1]);
  assert.match(m2, /Delivery address: 5 Temple Lane, Galle\nPostal code: 80000/);
  assert.match(m2, /1\. Magic Photo Mug \| Code: MG-001 \| Option: 11oz \| Qty: 1 \| Rs\. 1,650\n\nProduct subtotal: Rs\. 1,650/);
  assert.ok(!m2.includes('Polaroid'));
  await shop.goto(`${BASE}/#/cart`);
  assert.equal(await shop.textContent('#cart-count'), '4');
  ok('“Order on WhatsApp” uses the same checkout form for a single item and leaves the cart alone');

  // nothing sensitive persisted
  const stored = await shop.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.ok(!/Nimali|Kasun|Beach Road|81000|077/.test(stored), 'no checkout details in browser storage');
  ok('checkout details are not stored in the browser');

  /* ===== OWNER: update product, replace promotion, hide product (after "deployment") ===== */
  await admin.reload();
  await admin.fill('input[name=password]', 'wrong password!!');
  await admin.click('#login-form button');
  await admin.waitForSelector('#auth-error:not([hidden])');
  assert.match(await admin.textContent('#auth-error'), /Wrong password/);
  await admin.fill('input[name=password]', 'correct horse 42');
  await admin.click('#login-form button');
  await admin.waitForSelector('#savebar');
  ok('admin login rejects a wrong password and accepts the right one');

  await admin.click('[data-act=edit-product][data-i="1"]'.replace('"1"', `"${catalogOnDisk().products.findIndex((p) => p.code === 'MG-001')}"`));
  await admin.fill('[data-f=price]', '1700');
  await admin.fill('[data-o=price][data-i="0"]', '1700');
  await admin.fill('[data-f=description]', 'Updated description after launch.');
  await admin.selectOption('[data-f=stock]', 'low_stock');
  await admin.click('[data-act=product-done]');
  await admin.click('[data-tab=banners]');
  await admin.fill('[data-b=title][data-i="0"]', 'Christmas Gift Sale');
  await admin.setInputFiles('[data-banner-file="0"]', await sampleImg('banner2.png', '#0b6b2e', 1600, 700));
  await admin.waitForSelector('.banner-img[src^=blob]');
  await admin.click('#save-btn');
  await admin.waitForFunction(() => /Saved at/.test(document.getElementById('savebar').textContent));

  await shop.goto(`${BASE}/`);
  await shop.reload();
  await shop.waitForSelector('.hero');
  assert.match(await shop.textContent('.slide.on'), /Christmas Gift Sale/);
  assert.ok(!(await shop.textContent('.hero')).includes('Mother’s Day'));
  const heroImg = await shop.locator('.slide.on img').getAttribute('src');
  assert.equal(heroImg, catalogOnDisk().banners[0].image);
  await shop.goto(`${BASE}/#/product/MG-001`);
  assert.match(await shop.textContent('.info'), /Rs\. 1,700/);
  assert.match(await shop.textContent('.info'), /Low stock/);
  assert.match(await shop.textContent('.info'), /Updated description after launch/);
  ok('after launch: product update and replaced promotion both appear on the live site');

  await admin.click('[data-tab=products]');
  await admin.click(`[data-act=toggle-product][data-i="${catalogOnDisk().products.findIndex((p) => p.code === 'MG-001')}"]`);
  await admin.click('#save-btn');
  await admin.waitForFunction(() => /Saved at/.test(document.getElementById('savebar').textContent));
  await shop.goto(`${BASE}/#/shop?q=MG-001`);
  await shop.reload();
  assert.equal(await shop.locator('.product-card').count(), 0);
  await shop.goto(`${BASE}/#/product/MG-001`);
  assert.match(await shop.textContent('#app'), /Product not found/);
  await admin.click(`[data-act=toggle-product][data-i="${catalogOnDisk().products.findIndex((p) => p.code === 'MG-001')}"]`);
  await admin.click('#save-btn');
  await admin.waitForFunction(() => document.getElementById('save-btn').disabled && /Saved at/.test(document.getElementById('savebar').textContent));
  await shop.reload();
  await shop.waitForSelector('.product h1');
  ok('hide and reactivate product take effect on the storefront');

  await admin.click('[data-tab=settings]');
  await admin.fill('[data-s=whatsapp]', '0771112223');
  await admin.fill('[data-s=announcement]', 'Island-wide delivery');
  await admin.click('#save-btn');
  await admin.waitForFunction(() => /Saved at/.test(document.getElementById('savebar').textContent));
  assert.equal(catalogOnDisk().settings.whatsapp, '94771112223');
  await shop.goto(`${BASE}/`); await shop.reload();
  assert.match(await shop.textContent('#announce'), /Island-wide delivery/);
  assert.ok((await shop.locator('#wa-float').getAttribute('href')).startsWith('https://wa.me/94771112223'));
  ok('shop settings (WhatsApp number, announcement) update the live site');

  await admin.screenshot({ path: path.join(OUT, 'admin-mobile.png') });
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.goto(`${BASE}/#/product/MG-001`); await desk.waitForSelector('.product h1');
  await desk.screenshot({ path: path.join(OUT, 'product-desktop.png') });
  assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  ok('no JavaScript errors in the browser console');
  console.log(`\nE2E passed (${step} checks). Commits made by the admin: ${commits.length}. Screenshots in ${OUT}`);
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  console.error(e.stack?.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
