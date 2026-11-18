// Mathaka Gift Shop storefront: a small hash-routed single page app.
import { esc, fmtRs, waDigits, displayPhone } from './util.js';
import {
  loadCatalog, findProduct, visibleProducts, activeCategories, searchProducts, isOrderable,
  unitPrice, minQtyFor, listingPrice, STOCK,
} from './catalog.js';
import { Cart, resolveLines } from './cart.js';
import { validateCheckout, buildMessage, waLink } from './whatsapp.js';

const $app = document.getElementById('app');
let catalog = null;
let carouselTimer = null;

function safeStorage() {
  try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch { return null; }
}
const cart = new Cart(safeStorage());

/* ---------- helpers ---------- */
const PLACEHOLDER = 'images/placeholder.svg';
const mainImage = (p) => p.images[0] || PLACEHOLDER;
const safeLink = (l) => (/^(#\/|https?:\/\/)/.test(l || '') ? l : '');
const priceText = (p) => {
  const lp = listingPrice(p);
  return lp.price === null ? 'Ask on WhatsApp' : `${lp.from ? 'From ' : ''}${fmtRs(lp.price)}`;
};
const imgTag = (src, alt, extra = '') => `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" ${extra} onerror="this.onerror=null;this.src='${PLACEHOLDER}'">`;

function waHello() {
  const s = catalog.settings;
  return waLink(s.whatsapp, `Hi ${s.shopName}! I have a question.`);
}

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

function setTitle(t) {
  document.title = t ? `${t} | ${catalog.settings.shopName}` : `${catalog.settings.shopName} | Custom photo gifts, mugs and more`;
}

function toast(msg, href, linkText) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = `${esc(msg)} ${href ? `<a href="${esc(href)}">${esc(linkText)}</a>` : ''}`;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 4000);
}

/* ---------- page chrome ---------- */
function renderChrome() {
  const s = catalog.settings;
  document.getElementById('brand-logo').src = s.logo || 'images/logo.png';
  document.getElementById('brand-logo').alt = s.shopName;
  const ann = document.getElementById('announce');
  ann.hidden = !s.announcement;
  ann.textContent = s.announcement || '';

  const links = [`<a href="#/" data-nav="home">Home</a>`, `<a href="#/shop" data-nav="shop">All products</a>`]
    .concat(activeCategories(catalog).map((c) => `<a href="#/shop?cat=${encodeURIComponent(c.id)}" data-nav="cat-${esc(c.id)}">${esc(c.name)}</a>`));
  document.getElementById('nav-links').innerHTML = links.join('');

  document.getElementById('f-name').textContent = s.shopName;
  document.getElementById('f-copy-name').textContent = s.shopName;
  document.getElementById('f-tagline').innerHTML = `${esc(s.tagline)}${s.taglineSi ? `<br><span class="si">${esc(s.taglineSi)}</span>` : ''}`;
  const contact = [`<a href="${esc(waHello())}" target="_blank" rel="noopener">WhatsApp: ${esc(displayPhone(s.whatsapp))}</a>`];
  if (s.phone) contact.push(`<a href="tel:${esc(waDigits(s.phone))}">Call: ${esc(s.phone)}</a>`);
  if (s.phone2) contact.push(`<a href="tel:${esc(waDigits(s.phone2))}">Call: ${esc(s.phone2)}</a>`);
  if (s.email) contact.push(`<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`);
  if (s.address) contact.push(`<span>${esc(s.address)}</span>`);
  document.getElementById('f-contact').innerHTML = `<strong>Contact</strong>${contact.join('')}`;
  document.getElementById('f-links').innerHTML = `<strong>Follow us</strong>${s.facebook ? `<a href="${esc(s.facebook)}" target="_blank" rel="noopener">Facebook</a>` : ''}<a href="#/shop">Shop all products</a>`;
  document.getElementById('wa-float').href = waHello();
  document.getElementById('year').textContent = new Date().getFullYear();
  updateCartBadge();
}

function updateCartBadge() {
  const n = cart.count();
  const b = document.getElementById('cart-count');
  b.textContent = String(n);
  b.hidden = n === 0;
}

/* ---------- shared view pieces ---------- */
function productCard(p) {
  const out = !isOrderable(p);
  return `<a class="card product-card" href="#/product/${encodeURIComponent(p.code)}">
    <div class="card-img">${imgTag(mainImage(p), p.name)}${out ? '<span class="tag tag-out">Out of stock</span>' : ''}</div>
    <div class="card-body"><h3>${esc(p.name)}</h3><p class="code">Code: ${esc(p.code)}</p><p class="price">${esc(priceText(p))}</p></div>
  </a>`;
}

function noteHtml(p) {
  return p.customPrint || p.note ? `<p class="callout">📷 ${esc(p.note || 'After sending your order on WhatsApp, send your photos in the same chat.')}</p>` : '';
}

/* ---------- views ---------- */
function viewHome() {
  setTitle('');
  const s = catalog.settings;
  const banners = catalog.banners.filter((b) => b.active);
  const slides = banners.length
    ? banners.map((b, i) => {
      const href = safeLink(b.link);
      const inner = `${b.image ? imgTag(b.image, b.title || 'Promotion', i === 0 ? 'fetchpriority="high"' : '').replace('loading="lazy"', i === 0 ? '' : 'loading="lazy"') : ''}
        <div class="slide-text">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}${b.buttonText && href ? `<span class="btn btn-light">${esc(b.buttonText)}</span>` : ''}</div>`;
      return `<div class="slide ${i === 0 ? 'on' : ''} ${b.image ? '' : 'slide-plain'}" data-slide="${i}">${href ? `<a href="${esc(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${inner}</a>` : inner}</div>`;
    }).join('')
    : `<div class="slide on slide-plain"><div class="slide-text"><h2>${esc(s.tagline)}</h2><p>${esc(s.taglineSi)}</p><a class="btn btn-light" href="#/shop">Shop now</a></div></div>`;
  const dots = banners.length > 1 ? `<div class="dots">${banners.map((_, i) => `<button class="dot ${i === 0 ? 'on' : ''}" data-dot="${i}" aria-label="Show promotion ${i + 1}"></button>`).join('')}</div>` : '';

  const cats = activeCategories(catalog);
  const catTiles = cats.map((c) => {
    const n = visibleProducts(catalog).filter((p) => p.categoryId === c.id).length;
    return `<a class="cat-tile" href="#/shop?cat=${encodeURIComponent(c.id)}"><span class="cat-name">${esc(c.name)}</span><span class="cat-count">${n} item${n === 1 ? '' : 's'}</span></a>`;
  }).join('');

  const polaroid = visibleProducts(catalog).find((p) => p.customPrint);
  const polaroidHtml = polaroid ? `<section class="polaroid-feature" aria-labelledby="pol-h">
      <div><h2 id="pol-h">${esc(polaroid.name)}</h2><p>${esc(polaroid.description)}</p>
      <ul class="pol-options">${polaroid.options.map((o) => `<li><strong>${esc(o.label)}</strong>${o.size ? ` <span>${esc(o.size)}</span>` : ''}<em>${o.price === null ? 'Price on request' : esc(fmtRs(o.price))}</em><small>Min ${o.minQty}</small></li>`).join('')}</ul>
      ${noteHtml(polaroid)}
      <a class="btn" href="#/product/${encodeURIComponent(polaroid.code)}">Choose your print</a></div>
      <div class="pol-img">${imgTag(mainImage(polaroid), polaroid.name)}</div></section>` : '';

  const topList = catalog.topProducts.map((c) => findProduct(catalog, c)).filter((p) => p && p.active);
  const top = topList.length ? topList : visibleProducts(catalog).filter((p) => !p.customPrint).slice(0, 8);
  const topHtml = top.length ? `<section><h2 class="section-h">${topList.length ? 'Top Products' : 'Our Products'}</h2><div class="grid">${top.map(productCard).join('')}</div></section>`
    : `<section><h2 class="section-h">Top Products</h2><p class="muted">New gifts are on the way. Message us on WhatsApp to order anything custom.</p></section>`;

  return {
    html: `<section class="hero" aria-label="Promotions"><div class="slides">${slides}</div>${dots}</section>
      <ul class="trust"><li>✏️ Custom Design</li><li>🖨️ High Quality Printing</li><li>🎁 Gift Ready Frames</li><li>🚚 Fast Delivery</li></ul>
      ${cats.length ? `<section><h2 class="section-h">Shop by Category</h2><div class="cat-grid">${catTiles}</div></section>` : ''}
      ${polaroidHtml}${topHtml}`,
    after() {
      if (banners.length > 1) {
        const slidesEl = [...$app.querySelectorAll('.slide')];
        const dotEls = [...$app.querySelectorAll('.dot')];
        let cur = 0;
        const show = (i) => {
          cur = (i + slidesEl.length) % slidesEl.length;
          slidesEl.forEach((el, k) => el.classList.toggle('on', k === cur));
          dotEls.forEach((el, k) => el.classList.toggle('on', k === cur));
        };
        dotEls.forEach((d) => d.addEventListener('click', () => show(Number(d.dataset.dot))));
        carouselTimer = setInterval(() => show(cur + 1), 5500);
      }
    },
  };
}

function viewShop(query) {
  const q = query.get('q') || '';
  const cat = query.get('cat') || '';
  setTitle('Shop');
  const list = searchProducts(catalog, { q, categoryId: cat });
  const chips = [`<a class="chip ${cat ? '' : 'on'}" href="#/shop${q ? `?q=${encodeURIComponent(q)}` : ''}">All</a>`]
    .concat(activeCategories(catalog).map((c) => `<a class="chip ${cat === c.id ? 'on' : ''}" href="#/shop?cat=${encodeURIComponent(c.id)}${q ? `&q=${encodeURIComponent(q)}` : ''}">${esc(c.name)}</a>`)).join('');
  return {
    html: `<h1>${q ? `Results for “${esc(q)}”` : 'Shop all products'}</h1>
      <div class="chips" role="navigation" aria-label="Categories">${chips}</div>
      <p class="muted">${list.length} product${list.length === 1 ? '' : 's'} found</p>
      ${list.length ? `<div class="grid">${list.map(productCard).join('')}</div>` : `<div class="empty"><p>No products match your search.</p><p>Can’t find it? <a href="${esc(waHello())}" target="_blank" rel="noopener">Ask us on WhatsApp</a>.</p></div>`}`,
    after() { document.getElementById('search-input').value = q; },
  };
}

function notFound() {
  setTitle('Not found');
  return { html: '<div class="empty"><h1>Product not found</h1><p>This item may no longer be available.</p><a class="btn" href="#/shop">Browse products</a></div>' };
}

function viewProduct(code) {
  const p = findProduct(catalog, code);
  if (!p || !p.active) return notFound();
  setTitle(p.name);
  const orderable = isOrderable(p);
  const hasOpts = p.options.length > 0;
  const catName = (catalog.categories.find((c) => c.id === p.categoryId) || {}).name;
  const imgs = p.images.length ? p.images : [PLACEHOLDER];
  const stockLabel = STOCK[p.stock].label + (p.stockQty !== null && p.stock !== 'made_to_order' && p.stockQty > 0 ? ` (${p.stockQty} left)` : '');
  const optsHtml = hasOpts ? `<fieldset class="options"><legend>Choose an option</legend>${p.options.map((o, i) => `
      <label class="opt"><input type="radio" name="opt" value="${esc(o.id)}" ${i === 0 ? 'checked' : ''}>
      <span class="opt-body"><strong>${esc(o.label)}</strong>${o.size ? `<span>Size: ${esc(o.size)}</span>` : ''}<span class="opt-price">${o.price === null && p.price === null ? 'Price on request' : esc(fmtRs(o.price === null ? p.price : o.price))}</span><small>Minimum order: ${o.minQty}</small></span></label>`).join('')}</fieldset>` : '';
  const startOpt = hasOpts ? p.options[0].id : '';
  const startMin = minQtyFor(p, startOpt);
  return {
    html: `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a> › <a href="#/shop">Shop</a>${catName ? ` › <a href="#/shop?cat=${encodeURIComponent(p.categoryId)}">${esc(catName)}</a>` : ''}</nav>
      <article class="product">
        <div class="gallery"><div class="main-img">${imgTag(imgs[0], p.name, 'id="pmain"').replace('loading="lazy"', '')}</div>
          ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((s, i) => `<button type="button" class="thumb ${i === 0 ? 'on' : ''}" data-src="${esc(s)}" aria-label="Photo ${i + 1}">${imgTag(s, '')}</button>`).join('')}</div>` : ''}</div>
        <div class="info">
          <h1>${esc(p.name)}</h1>
          <p class="code">Item code: <strong>${esc(p.code)}</strong></p>
          <p class="avail ${orderable ? 'ok' : 'no'}">${orderable ? '●' : '○'} ${esc(stockLabel)}</p>
          <p class="big-price" id="pprice" aria-live="polite"></p>
          ${p.description ? `<p class="desc">${esc(p.description).replace(/\n/g, '<br>')}</p>` : ''}
          ${noteHtml(p)}
          <form id="buy" novalidate>
            ${optsHtml}
            <div class="qty-row"><label for="qty">Quantity</label>
              <input id="qty" type="number" inputmode="numeric" min="${startMin}" step="1" value="${startMin}" ${orderable ? '' : 'disabled'}>
              <span id="minhint" class="muted"></span></div>
            <p id="buy-error" class="error" role="alert" hidden></p>
            <div class="actions">
              <button type="button" class="btn" data-action="add" ${orderable ? '' : 'disabled'}>Add to cart</button>
              <button type="button" class="btn btn-wa" data-action="direct" ${orderable ? '' : 'disabled'}>Order on WhatsApp</button>
            </div>
            ${orderable ? '' : '<p class="muted">This item is out of stock. Message us on WhatsApp to ask about availability.</p>'}
          </form>
        </div>
      </article>`,
    after() {
      const form = document.getElementById('buy');
      const qty = document.getElementById('qty');
      const err = document.getElementById('buy-error');
      const sel = () => (form.querySelector('input[name=opt]:checked') || {}).value || '';
      const updatePrice = () => {
        const unit = unitPrice(p, sel());
        const n = Math.max(1, parseInt(qty.value, 10) || 1);
        document.getElementById('pprice').textContent = unit === null ? 'Price on request. We will confirm it on WhatsApp.' : `${fmtRs(unit)}${n > 1 ? ` × ${n} = ${fmtRs(unit * n)}` : ''}`;
      };
      // Option changed: apply that option's minimum. Typing in the quantity box is never overwritten.
      const applyOption = () => {
        const min = minQtyFor(p, sel());
        qty.min = String(min);
        if (!(Number(qty.value) >= min)) qty.value = String(min);
        document.getElementById('minhint').textContent = min > 1 ? `Minimum order: ${min}` : '';
        updatePrice();
      };
      const read = () => {
        const opt = sel();
        const min = minQtyFor(p, opt);
        const n = parseInt(qty.value, 10);
        if (!Number.isInteger(n) || n < 1) return { error: 'Please enter a valid quantity.' };
        if (n < min) return { error: `The minimum order for this option is ${min}.` };
        return { opt, n };
      };
      form.addEventListener('change', (e) => { err.hidden = true; if (e.target.name === 'opt') applyOption(); else updatePrice(); });
      qty.addEventListener('input', () => { err.hidden = true; updatePrice(); });
      form.addEventListener('submit', (e) => e.preventDefault());
      applyOption();
      $app.querySelectorAll('.thumb').forEach((t) => t.addEventListener('click', () => {
        document.getElementById('pmain').src = t.dataset.src;
        $app.querySelectorAll('.thumb').forEach((x) => x.classList.toggle('on', x === t));
      }));
      form.querySelector('[data-action=add]').addEventListener('click', () => {
        const r = read();
        if (r.error) { err.textContent = r.error; err.hidden = false; return; }
        cart.add(p.code, r.opt, r.n);
        updateCartBadge();
        toast(`Added ${r.n} × ${p.name} to your cart.`, '#/cart', 'View cart');
      });
      form.querySelector('[data-action=direct]').addEventListener('click', () => {
        const r = read();
        if (r.error) { err.textContent = r.error; err.hidden = false; return; }
        location.hash = `#/checkout?code=${encodeURIComponent(p.code)}&opt=${encodeURIComponent(r.opt)}&qty=${r.n}`;
      });
    },
  };
}

function viewCart() {
  setTitle('Cart');
  const { lines, subtotal, unpricedCount, dropped, belowMin } = resolveLines(catalog, cart.items());
  if (!lines.length) {
    return { html: `<h1>Your cart</h1><div class="empty"><p>Your cart is empty.</p><a class="btn" href="#/shop">Browse products</a></div>` };
  }
  const hasPrint = lines.some((l) => l.product.customPrint);
  return {
    html: `<h1>Your cart</h1>
      ${dropped.length ? '<p class="callout warn">Some items are no longer available and were left out.</p>' : ''}
      <ul class="cart-list">${lines.map((l) => `<li class="cart-line">
        <a href="#/product/${encodeURIComponent(l.code)}" class="cl-img">${imgTag(mainImage(l.product), l.name)}</a>
        <div class="cl-info"><a href="#/product/${encodeURIComponent(l.code)}"><strong>${esc(l.name)}</strong></a>
          <small>Code: ${esc(l.code)}${l.optionLabel ? ` · ${esc(l.optionLabel)}` : ''}</small>
          <small>${l.unit === null ? 'Price on request' : `${esc(fmtRs(l.unit))} each`}${l.minQty > 1 ? ` · min ${l.minQty}` : ''}</small>
          <div class="qty-ctl"><button type="button" data-act="dec" data-key="${esc(l.key)}" aria-label="Decrease quantity">−</button>
            <input type="number" min="${l.minQty}" value="${l.qty}" data-act="set" data-key="${esc(l.key)}" aria-label="Quantity for ${esc(l.name)}">
            <button type="button" data-act="inc" data-key="${esc(l.key)}" aria-label="Increase quantity">+</button>
            <button type="button" class="link" data-act="rm" data-key="${esc(l.key)}">Remove</button></div></div>
        <div class="cl-total">${l.total === null ? 'TBC' : esc(fmtRs(l.total))}</div></li>`).join('')}</ul>
      <div class="summary"><p>Product subtotal: <strong>${esc(fmtRs(subtotal) || 'Rs. 0')}</strong></p>
        ${unpricedCount ? `<p class="muted">${unpricedCount} item${unpricedCount > 1 ? 's have' : ' has'} no price yet. We will confirm ${unpricedCount > 1 ? 'them' : 'it'} on WhatsApp.</p>` : ''}
        <p class="muted">${esc(catalog.settings.deliveryNote)}</p>
        ${hasPrint ? '<p class="callout">📷 Polaroid prints: after sending your order, send your photos in the same WhatsApp chat.</p>' : ''}
        ${belowMin ? '<p class="error">Some quantities are below the minimum order. Please increase them.</p>' : ''}
        <div class="actions"><a class="btn" href="#/shop">Continue shopping</a>
          <a class="btn btn-wa ${belowMin ? 'disabled' : ''}" ${belowMin ? 'aria-disabled="true"' : 'href="#/checkout"'}>Checkout</a></div></div>`,
    after() {
      const redraw = () => { updateCartBadge(); route(); };
      $app.querySelectorAll('[data-act]').forEach((el) => {
        const key = el.dataset.key;
        const line = lines.find((l) => l.key === key);
        if (el.dataset.act === 'inc') el.addEventListener('click', () => { cart.setQty(key, line.qty + 1); redraw(); });
        if (el.dataset.act === 'dec') el.addEventListener('click', () => { cart.setQty(key, Math.max(line.minQty, line.qty - 1)); redraw(); });
        if (el.dataset.act === 'rm') el.addEventListener('click', () => { cart.remove(key); redraw(); });
        if (el.dataset.act === 'set') el.addEventListener('change', () => { cart.setQty(key, Math.max(line.minQty, parseInt(el.value, 10) || line.minQty)); redraw(); });
      });
    },
  };
}

function viewCheckout(query) {
  setTitle('Checkout');
  const direct = query.get('code');
  let items;
  if (direct) {
    const p = findProduct(catalog, direct);
    const opt = query.get('opt') || '';
    const min = p ? minQtyFor(p, opt) : 1;
    items = [{ code: direct, optionId: opt, qty: Math.max(min, parseInt(query.get('qty'), 10) || min) }];
  } else {
    items = cart.items();
  }
  const { lines, subtotal, unpricedCount, belowMin } = resolveLines(catalog, items);
  if (!lines.length) {
    return { html: `<h1>Checkout</h1><div class="empty"><p>There is nothing to order yet.</p><a class="btn" href="#/shop">Browse products</a></div>` };
  }
  const hasPrint = lines.some((l) => l.product.customPrint);
  const s = catalog.settings;
  const field = (id, label, attrs = '', tag = 'input') => `<div class="field"><label for="f-${id}">${label}</label>
      ${tag === 'textarea' ? `<textarea id="f-${id}" rows="3" ${attrs}></textarea>` : `<input id="f-${id}" ${attrs}>`}<p class="error" id="e-${id}" hidden></p></div>`;
  return {
    html: `<h1>Checkout</h1>
      ${direct ? '<p class="callout">You are ordering only this item. Your cart has not been changed.</p>' : ''}
      <div class="checkout">
        <section class="co-summary" aria-label="Order summary"><h2>Order summary</h2>
          <ul class="sum-list">${lines.map((l) => `<li><span>${esc(l.name)}<small>Code: ${esc(l.code)}${l.optionLabel ? ` · ${esc(l.optionLabel)}` : ''} · Qty ${l.qty}</small></span><strong>${l.total === null ? 'TBC' : esc(fmtRs(l.total))}</strong></li>`).join('')}</ul>
          <p class="sum-total">Product subtotal: <strong>${esc(fmtRs(subtotal) || 'Rs. 0')}</strong></p>
          ${unpricedCount ? '<p class="muted">Items marked TBC will be priced on WhatsApp.</p>' : ''}
          <p class="muted">${esc(s.deliveryNote)}</p>
          ${hasPrint ? '<p class="callout">📷 Polaroid prints: after you send your order, send the photos you want printed in the same WhatsApp chat.</p>' : ''}
          ${belowMin ? '<p class="error">Some quantities are below the minimum order. Please go back and increase them.</p>' : ''}
        </section>
        <form id="co-form" class="co-form" novalidate>
          <h2>Delivery details</h2>
          ${field('name', 'Full name', 'type="text" autocomplete="name" required')}
          ${field('phone', 'Your WhatsApp number', 'type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0771234567" required')}
          ${field('address', 'Delivery address', 'autocomplete="street-address" required', 'textarea')}
          ${field('city', 'City / town', 'type="text" autocomplete="address-level2" required')}
          ${field('postal', 'Postal code / ZIP code', 'type="text" inputmode="text" autocomplete="postal-code" required')}
          ${field('notes', 'Order notes (optional)', '', 'textarea')}
          <div class="actions">
            <button type="submit" class="btn btn-wa" id="go-wa" ${belowMin ? 'disabled' : ''}>Continue to WhatsApp</button>
            <button type="button" class="btn btn-ghost" id="copy-msg" ${belowMin ? 'disabled' : ''}>Copy message</button>
          </div>
          <div id="wa-help" class="callout" role="status" hidden></div>
          <details class="preview"><summary>Preview the message</summary><pre id="msg-preview">Fill in the form to preview your message.</pre></details>
          <p class="muted tiny">We do not save these details on this website. They only go into your WhatsApp message.</p>
        </form>
      </div>`,
    after() {
      const form = document.getElementById('co-form');
      const ids = ['name', 'phone', 'address', 'city', 'postal', 'notes'];
      const read = () => Object.fromEntries(ids.map((i) => [i, document.getElementById(`f-${i}`).value]));
      const build = (v) => buildMessage({
        shopName: s.shopName,
        customer: { name: v.name, phone: v.phone, address: v.address, city: v.city, postal: v.postal },
        lines, subtotal, unpricedCount, notes: v.notes,
      });
      const check = () => {
        const v = read();
        const r = validateCheckout(v);
        ids.forEach((i) => {
          const e = document.getElementById(`e-${i}`);
          const input = document.getElementById(`f-${i}`);
          const msg = r.errors[i];
          e.hidden = !msg; e.textContent = msg || '';
          input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        });
        if (!r.ok) {
          const first = ids.find((i) => r.errors[i]);
          document.getElementById(`f-${first}`).focus();
          return null;
        }
        return v;
      };
      const updatePreview = () => {
        const v = read();
        const ok = validateCheckout(v).ok;
        document.getElementById('msg-preview').textContent = ok ? build(v) : 'Fill in the form to preview your message.';
      };
      form.addEventListener('input', updatePreview);
      const help = document.getElementById('wa-help');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (belowMin) return;
        const v = check();
        if (!v) return;
        const msg = build(v);
        const url = waLink(s.whatsapp, msg);
        const w = window.open(url, '_blank');
        if (!w) window.location.href = url;
        help.hidden = false;
        help.innerHTML = `<strong>Almost there. Your order is not sent yet.</strong><br>WhatsApp should open with your message filled in. <b>Tap Send inside WhatsApp</b> to place your order with us.${hasPrint ? ' Then send your photos in the same chat.' : ''}<br>If WhatsApp did not open, tap “Copy message” and paste it into our chat (${esc(displayPhone(s.whatsapp))}). Your cart is still saved here.`;
      });
      document.getElementById('copy-msg').addEventListener('click', async () => {
        if (belowMin) return;
        const v = check();
        if (!v) return;
        const msg = build(v);
        let ok = false;
        try { await navigator.clipboard.writeText(msg); ok = true; } catch {
          const ta = document.createElement('textarea');
          ta.value = msg; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { ok = document.execCommand('copy'); } catch { ok = false; }
          ta.remove();
        }
        help.hidden = false;
        help.innerHTML = ok
          ? `Message copied. Open our WhatsApp chat (${esc(displayPhone(s.whatsapp))}), paste it, and <b>tap Send</b> to place your order. Nothing is sent until you do.`
          : 'Could not copy automatically. Open “Preview the message” below, select the text and copy it manually.';
        if (!ok) document.querySelector('.preview').open = true;
        document.getElementById('msg-preview').textContent = msg;
      });
    },
  };
}

/* ---------- router ---------- */
function route() {
  clearInterval(carouselTimer);
  if (!catalog) return;
  const { parts, query } = parseHash();
  let view;
  const [a, b] = parts;
  if (!a) view = viewHome();
  else if (a === 'shop') view = viewShop(query);
  else if (a === 'product' && b) view = viewProduct(b);
  else if (a === 'cart') view = viewCart();
  else if (a === 'checkout') view = viewCheckout(query);
  else view = notFound();
  $app.innerHTML = view.html;
  document.getElementById('main-nav').classList.remove('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
  if (view.after) view.after();
  const current = !a ? '#/' : (a === 'shop' && query.get('cat') ? `#/shop?cat=${encodeURIComponent(query.get('cat'))}` : (a === 'shop' ? '#/shop' : ''));
  document.querySelectorAll('#nav-links a').forEach((l) => l.classList.toggle('on', l.getAttribute('href') === current));
  updateCartBadge();
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
document.getElementById('menu-btn').addEventListener('click', () => {
  const nav = document.getElementById('main-nav');
  const open = nav.classList.toggle('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
});
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('search-input').value.trim();
  location.hash = q ? `#/shop?q=${encodeURIComponent(q)}` : '#/shop';
});

async function init() {
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $app.innerHTML = `<div class="empty"><h1>We could not load the shop</h1><p>Please check your connection and try again.</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
    return;
  }
  renderChrome();
  route();
}
init();
