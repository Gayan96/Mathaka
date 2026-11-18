// Mathaka Gift Shop admin dashboard.
// Runs entirely in the browser. Changes are saved as commits to the shop's GitHub repository
// (data/catalog.json + images/), and the host republishes the site automatically.
import { esc, slugify, fmtRs, waDigits, displayPhone } from '../js/util.js';
import { normalize, STOCK } from '../js/catalog.js';
import { GitHub, GitHubError } from './github.js';
import { seal, unseal } from './vault.js';

const VAULT_KEY = 'mathaka_admin_vault_v1';
const CATALOG_PATH = 'data/catalog.json';
const IDLE_LOCK_MS = 30 * 60 * 1000;
const $screen = document.getElementById('screen');

const S = {
  gh: null, cat: null, sha: null, pending: new Map(), dirty: false,
  tab: 'products', editing: null, filter: '', lockTimer: null, saving: false, notice: '',
};

/* ---------- tiny helpers ---------- */
const store = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch { return null; } })();
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, 5000);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const imgSrc = (path) => (S.pending.has(path) ? S.pending.get(path).url : /^https?:/.test(path) ? path : `../${path}`);
const markDirty = () => { S.dirty = true; updateSaveBar(); };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
const reorder = (arr) => arr.forEach((x, i) => { x.order = i; });

function friendly(e) {
  return e instanceof GitHubError || e instanceof Error ? e.message : 'Something went wrong.';
}

/* ---------- images ---------- */
async function processImage(file, { maxW = 1400, png = false } = {}) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is larger than 15 MB. Please choose a smaller one.');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('That file could not be read as an image.'); }
  const scale = Math.min(1, maxW / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.86));
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  return { b64, ext: png ? 'png' : 'jpg', url: URL.createObjectURL(blob) };
}
function addPending(path, res) { S.pending.set(path, { b64: res.b64, url: res.url }); }

/* ---------- screens: setup / login ---------- */
function showSetup() {
  $screen.innerHTML = `<section class="auth card">
    <img src="../images/logo.png" alt="" class="auth-logo">
    <h1>Connect your shop</h1>
    <p class="muted">One-time setup on this device. Your GitHub access token is encrypted with the password you choose here and never leaves this browser.</p>
    <form id="setup-form" novalidate>
      <label>GitHub username or organisation<input name="owner" required autocomplete="off" placeholder="e.g. mathakagift"></label>
      <label>Repository name<input name="repo" required autocomplete="off" placeholder="e.g. mathaka-shop"></label>
      <label>Branch<input name="branch" value="main" required autocomplete="off"></label>
      <label>GitHub access token<input name="token" type="password" required autocomplete="off" placeholder="github_pat_…"></label>
      <label>Choose an admin password (min. 10 characters)<input name="password" type="password" required autocomplete="new-password" minlength="10"></label>
      <label>Repeat the password<input name="password2" type="password" required autocomplete="new-password"></label>
      <details><summary>Advanced</summary><label>GitHub API address<input name="apiBase" value="https://api.github.com" autocomplete="off"></label></details>
      <p id="auth-error" class="error" role="alert" hidden></p>
      <button class="btn" type="submit">Connect and open dashboard</button>
    </form>
  </section>`;
  const form = document.getElementById('setup-form');
  const err = document.getElementById('auth-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const f = Object.fromEntries(new FormData(form));
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!f.owner.trim() || !f.repo.trim() || !f.branch.trim() || !f.token.trim()) return fail('Please fill in every field.');
    if (f.password.length < 10) return fail('Please choose a password of at least 10 characters.');
    if (f.password !== f.password2) return fail('The two passwords do not match.');
    const cfg = { owner: f.owner.trim(), repo: f.repo.trim(), branch: f.branch.trim(), token: f.token.trim(), apiBase: (f.apiBase || 'https://api.github.com').trim() };
    const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const gh = new GitHub(cfg);
      await gh.verify();
      const file = await gh.getFile(CATALOG_PATH);
      if (!file) throw new Error(`Connected, but ${CATALOG_PATH} was not found on branch “${cfg.branch}”. Check the branch name and that the project files were uploaded.`);
      const blob = await seal(cfg, f.password);
      if (store) store.setItem(VAULT_KEY, JSON.stringify(blob));
      await openDashboard(gh, file);
    } catch (ex) {
      fail(friendly(ex)); btn.disabled = false; btn.textContent = 'Connect and open dashboard';
    }
  });
}

function showLogin() {
  $screen.innerHTML = `<section class="auth card">
    <img src="../images/logo.png" alt="" class="auth-logo">
    <h1>Shop admin</h1>
    <form id="login-form" novalidate>
      <label>Admin password<input name="password" type="password" required autocomplete="current-password" autofocus></label>
      <p id="auth-error" class="error" role="alert" hidden></p>
      <button class="btn" type="submit">Log in</button>
    </form>
    <p class="muted tiny"><button class="link" id="forget" type="button">Reset this device</button> (use this if you forgot the password; you will need your GitHub token again)</p>
  </section>`;
  const form = document.getElementById('login-form');
  const err = document.getElementById('auth-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      let cfg;
      try { cfg = await unseal(JSON.parse(store.getItem(VAULT_KEY)), new FormData(form).get('password')); } catch { throw new Error('Wrong password.'); }
      const gh = new GitHub(cfg);
      await gh.verify();
      const file = await gh.getFile(CATALOG_PATH);
      if (!file) throw new Error(`${CATALOG_PATH} was not found in the repository.`);
      await openDashboard(gh, file);
    } catch (ex) {
      err.textContent = friendly(ex); err.hidden = false; btn.disabled = false; btn.textContent = 'Log in';
    }
  });
  document.getElementById('forget').addEventListener('click', () => {
    if (confirm('Remove the saved connection from this device? You will need to enter your GitHub token again.')) {
      store.removeItem(VAULT_KEY); showSetup();
    }
  });
}

async function openDashboard(gh, file) {
  S.gh = gh;
  S.sha = file.sha;
  S.cat = normalize(JSON.parse(file.text));
  S.pending = new Map(); S.dirty = false; S.editing = null; S.tab = 'products'; S.notice = '';
  armIdleLock();
  renderDashboard();
}

function lock() {
  if (S.dirty && !confirm('You have unsaved changes. Lock anyway? They will be lost.')) return;
  clearTimeout(S.lockTimer);
  Object.assign(S, { gh: null, cat: null, sha: null, pending: new Map(), dirty: false, editing: null });
  showLogin();
}
function armIdleLock() {
  clearTimeout(S.lockTimer);
  S.lockTimer = setTimeout(() => {
    if (!S.dirty) { Object.assign(S, { gh: null, cat: null }); showLogin(); } else armIdleLock();
  }, IDLE_LOCK_MS);
}
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { if (S.gh) armIdleLock(); }, { passive: true }));

/* ---------- dashboard shell ---------- */
const TABS = [['products', 'Products'], ['categories', 'Categories'], ['top', 'Top Products'], ['banners', 'Banners'], ['settings', 'Shop settings']];

function renderDashboard() {
  $screen.innerHTML = `<div class="dash">
    <header class="dash-head"><div class="dash-title"><img src="../images/logo.png" alt=""><strong>Shop admin</strong></div>
      <div class="dash-links"><a href="../" target="_blank" rel="noopener">View shop ↗</a><button class="link" id="lock" type="button">Lock</button></div></header>
    <div id="savebar" class="savebar"></div>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, label]) => `<button type="button" data-tab="${id}" class="${S.tab === id ? 'on' : ''}">${label}</button>`).join('')}</nav>
    <section id="content" class="content"></section></div>`;
  document.getElementById('lock').addEventListener('click', lock);
  $screen.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    S.tab = b.dataset.tab; S.editing = null; renderDashboard();
  });
  bindContent();
  renderTab();
  updateSaveBar();
}

function updateSaveBar() {
  const bar = document.getElementById('savebar');
  if (!bar) return;
  bar.className = `savebar ${S.dirty ? 'dirty' : ''}`;
  bar.innerHTML = `<span id="save-msg">${S.saving ? 'Saving…' : S.dirty ? 'You have unsaved changes.' : (S.notice || 'All changes saved.')}</span>
    <button class="btn" id="save-btn" type="button" ${S.dirty && !S.saving ? '' : 'disabled'}>Save changes to website</button>`;
  document.getElementById('save-btn').addEventListener('click', saveAll);
}

function renderTab() {
  const c = document.getElementById('content');
  if (S.tab === 'products') c.innerHTML = S.editing ? productForm() : productsList();
  if (S.tab === 'categories') c.innerHTML = categoriesTab();
  if (S.tab === 'top') c.innerHTML = topTab();
  if (S.tab === 'banners') c.innerHTML = bannersTab();
  if (S.tab === 'settings') c.innerHTML = settingsTab();
}

/* ---------- save ---------- */
function validateSettings() {
  const s = S.cat.settings;
  const d = waDigits(s.whatsapp);
  if (!/^\d{10,15}$/.test(d)) return 'The WhatsApp number must include the country code, e.g. 94742899909.';
  s.whatsapp = d;
  if (s.facebook && !/^https?:\/\//.test(s.facebook)) return 'The Facebook link must start with https://';
  return '';
}

async function saveAll() {
  if (S.saving) return;
  const bad = validateSettings();
  if (bad) { toast(bad, 'err'); S.tab = 'settings'; renderDashboard(); return; }
  S.saving = true; updateSaveBar();
  try {
    reorder(S.cat.categories); reorder(S.cat.banners);
    const json = JSON.stringify(S.cat, null, 2);
    const used = [...S.pending.keys()].filter((p) => json.includes(`"${p}"`));
    for (const path of used) {
      const { b64 } = S.pending.get(path);
      await S.gh.putBase64(path, b64, `Admin: add image ${path.split('/').pop()}`);
    }
    S.sha = await S.gh.putText(CATALOG_PATH, `${json}\n`, 'Admin: update shop catalogue', S.sha);
    S.pending.forEach((v) => URL.revokeObjectURL(v.url));
    S.pending = new Map();
    S.dirty = false;
    S.notice = `Saved at ${new Date().toLocaleTimeString()}. Your website updates after the host republishes (usually a few minutes).`;
    toast('Saved. The live website will update in a few minutes.');
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
      toast('The catalogue was changed somewhere else. Reload the page to get the latest version, then redo your edit.', 'err');
    } else toast(friendly(e), 'err');
  } finally {
    S.saving = false; updateSaveBar(); if (S.tab) renderTab();
  }
}
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Products ---------- */
function statusBadges(p) {
  return `${p.active ? '' : '<span class="pill grey">Hidden</span>'}${STOCK[p.stock].orderable ? '' : '<span class="pill red">Out of stock</span>'}${p.customPrint ? '<span class="pill">Custom print</span>' : ''}`;
}
function priceCell(p) {
  const prices = [p.price, ...p.options.map((o) => o.price)].filter((x) => x !== null);
  if (!prices.length) return 'Price not set';
  const min = Math.min(...prices);
  return `${p.options.length && new Set(prices).size > 1 ? 'From ' : ''}${fmtRs(min)}`;
}
function productsList() {
  const q = S.filter.toLowerCase();
  const list = S.cat.products.map((p, i) => ({ p, i })).filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  return `<div class="toolbar"><input id="pfilter" type="search" placeholder="Search by name or item code" value="${esc(S.filter)}" aria-label="Search products"><button class="btn" data-act="new-product" type="button">+ Add product</button></div>
    ${list.length ? `<ul class="rows">${list.map(({ p, i }) => `<li class="row ${p.active ? '' : 'faded'}">
      <img src="${esc(p.images[0] ? imgSrc(p.images[0]) : '../images/placeholder.svg')}" alt="" class="thumb">
      <div class="grow"><strong>${esc(p.name)}</strong><small>Code: ${esc(p.code)} · ${esc(priceCell(p))}</small><div>${statusBadges(p)}</div></div>
      <div class="row-btns"><button class="btn small ghost" data-act="edit-product" data-i="${i}" type="button">Edit</button>
      <button class="btn small ghost" data-act="toggle-product" data-i="${i}" type="button">${p.active ? 'Hide' : 'Reactivate'}</button></div></li>`).join('')}</ul>`
    : '<p class="muted">No products yet. Tap “Add product” to create your first one.</p>'}`;
}

function newProductDraft() {
  const nums = S.cat.products.map((p) => /^MG-(\d+)$/.exec(p.code)).filter(Boolean).map((m) => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return {
    code: `MG-${String(next).padStart(3, '0')}`, name: '', categoryId: (S.cat.categories[0] || {}).id || '', price: null, description: '',
    stock: 'in_stock', stockQty: null, minQty: 1, active: true, customPrint: false, images: [], options: [], note: '',
  };
}

function productForm() {
  const d = S.editing.draft;
  const cats = S.cat.categories;
  return `<form id="pform" class="form" novalidate>
    <h2>${S.editing.index === -1 ? 'Add product' : 'Edit product'}</h2>
    <label>Item name<input data-f="name" value="${esc(d.name)}" required></label>
    <div class="two"><label>Item code (unique)<input data-f="code" value="${esc(d.code)}" required></label>
    <label>Category<select data-f="categoryId"><option value="">No category</option>${cats.map((c) => `<option value="${esc(c.id)}" ${d.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="two"><label>Price (Rs.)<input data-f="price" inputmode="decimal" value="${d.price === null ? '' : esc(d.price)}" placeholder="Leave blank to show “Ask on WhatsApp”"></label>
    <label>Minimum order quantity<input data-f="minQty" inputmode="numeric" value="${esc(d.minQty)}"></label></div>
    <div class="two"><label>Availability<select data-f="stock">${Object.entries(STOCK).map(([k, v]) => `<option value="${k}" ${d.stock === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <label>Stock quantity (optional)<input data-f="stockQty" inputmode="numeric" value="${d.stockQty === null ? '' : esc(d.stockQty)}"></label></div>
    <label>Description<textarea data-f="description" rows="4">${esc(d.description)}</textarea></label>
    <label class="check"><input type="checkbox" data-f="customPrint" ${d.customPrint ? 'checked' : ''}> Custom photo print (shows the “send your photos on WhatsApp” note; the first such product appears in the home page featured section)</label>
    <label>Note shown to customers (optional)<textarea data-f="note" rows="2">${esc(d.note)}</textarea></label>
    <label class="check"><input type="checkbox" data-f="active" ${d.active ? 'checked' : ''}> Visible on the website</label>

    <fieldset><legend>Options (sizes / styles)</legend>
      <p class="muted tiny">Leave empty if the product has no options. Each option can have its own price and minimum quantity.</p>
      ${d.options.map((o, i) => `<div class="opt-row">
        <input data-o="label" data-i="${i}" value="${esc(o.label)}" placeholder="Name (e.g. Mini)" aria-label="Option name">
        <input data-o="size" data-i="${i}" value="${esc(o.size)}" placeholder="Size (e.g. 2×3 in)" aria-label="Option size">
        <input data-o="price" data-i="${i}" inputmode="decimal" value="${o.price === null ? '' : esc(o.price)}" placeholder="Price Rs." aria-label="Option price">
        <input data-o="minQty" data-i="${i}" inputmode="numeric" value="${esc(o.minQty)}" placeholder="Min qty" aria-label="Option minimum quantity">
        <div class="mini-btns"><button type="button" class="btn small ghost" data-act="opt-up" data-i="${i}" aria-label="Move up">↑</button><button type="button" class="btn small ghost" data-act="opt-down" data-i="${i}" aria-label="Move down">↓</button><button type="button" class="btn small ghost" data-act="opt-del" data-i="${i}" aria-label="Remove option">✕</button></div></div>`).join('')}
      <button type="button" class="btn small ghost" data-act="opt-add">+ Add option</button>
    </fieldset>

    <fieldset><legend>Photos</legend>
      <p class="muted tiny">The first photo is the main photo. JPG, PNG or WebP, up to 15 MB each (they are resized automatically).</p>
      <div class="img-grid">${d.images.map((p, i) => `<figure class="img-cell"><img src="${esc(imgSrc(p))}" alt="Product photo ${i + 1}">${i === 0 ? '<span class="pill">Main</span>' : ''}
        <div class="mini-btns">${i !== 0 ? `<button type="button" class="btn small ghost" data-act="img-main" data-i="${i}">Make main</button>` : ''}
        <button type="button" class="btn small ghost" data-act="img-left" data-i="${i}" aria-label="Move earlier">←</button><button type="button" class="btn small ghost" data-act="img-right" data-i="${i}" aria-label="Move later">→</button>
        <button type="button" class="btn small ghost" data-act="img-del" data-i="${i}" aria-label="Remove photo">✕</button></div></figure>`).join('')}</div>
      <label class="file">Add photos<input type="file" id="pimg" accept="image/jpeg,image/png,image/webp" multiple></label>
    </fieldset>
    <p id="pform-error" class="error" role="alert" hidden></p>
    <div class="actions"><button type="button" class="btn" data-act="product-done">Done</button><button type="button" class="btn ghost" data-act="product-cancel">Cancel</button></div>
  </form>`;
}

function applyProductDraft() {
  const d = S.editing.draft;
  const err = (m) => { const e = document.getElementById('pform-error'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'center' }); return false; };
  const name = d.name.trim();
  const code = d.code.trim();
  if (!name) return err('Please enter the item name.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(code)) return err('The item code must be 2–30 letters, numbers, dashes or underscores, with no spaces.');
  if (S.cat.products.some((p, i) => i !== S.editing.index && p.code.toLowerCase() === code.toLowerCase())) return err(`The item code ${code} is already used by another product.`);
  const price = String(d.price ?? '').trim() === '' ? null : Number(d.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return err('Please enter a valid price, or leave it blank.');
  const minQty = parseInt(d.minQty, 10);
  if (!Number.isInteger(minQty) || minQty < 1) return err('The minimum order quantity must be 1 or more.');
  const stockQty = String(d.stockQty ?? '').trim() === '' ? null : parseInt(d.stockQty, 10);
  if (stockQty !== null && (!Number.isInteger(stockQty) || stockQty < 0)) return err('Stock quantity must be a whole number or blank.');
  const used = new Set();
  const options = [];
  for (const o of d.options) {
    const label = String(o.label).trim();
    if (!label) return err('Every option needs a name, or remove the empty option.');
    const op = String(o.price ?? '').trim() === '' ? null : Number(o.price);
    if (op !== null && (!Number.isFinite(op) || op < 0)) return err(`Please enter a valid price for the “${label}” option, or leave it blank.`);
    const omq = parseInt(o.minQty, 10);
    if (!Number.isInteger(omq) || omq < 1) return err(`The minimum quantity for “${label}” must be 1 or more.`);
    let id = o.id || slugify(label);
    while (used.has(id)) id += `-${uid().slice(-3)}`;
    used.add(id);
    options.push({ id, label, size: String(o.size || '').trim(), price: op, minQty: omq });
  }
  const finished = {
    code, name, categoryId: d.categoryId, price, description: d.description.trim(), stock: d.stock, stockQty, minQty,
    active: d.active, customPrint: !!d.customPrint, images: d.images, options, note: d.note.trim(),
  };
  if (S.editing.index === -1) S.cat.products.push(finished);
  else {
    const oldCode = S.cat.products[S.editing.index].code;
    S.cat.products[S.editing.index] = finished;
    if (oldCode !== code) S.cat.topProducts = S.cat.topProducts.map((c) => (c === oldCode ? code : c));
  }
  S.editing = null;
  markDirty();
  return true;
}

/* ---------- Categories ---------- */
function categoriesTab() {
  const cats = S.cat.categories;
  return `<p class="muted">Categories appear on the home page and as filters in the shop. Hidden categories are not shown as filters, but their products stay in “All products”.</p>
    <ul class="rows">${cats.map((c, i) => `<li class="row"><div class="grow"><input data-cat="name" data-i="${i}" value="${esc(c.name)}" aria-label="Category name"></div>
      <label class="check"><input type="checkbox" data-cat="active" data-i="${i}" ${c.active ? 'checked' : ''}> Visible</label>
      <div class="mini-btns"><button class="btn small ghost" data-act="cat-up" data-i="${i}" type="button" aria-label="Move up">↑</button><button class="btn small ghost" data-act="cat-down" data-i="${i}" type="button" aria-label="Move down">↓</button></div></li>`).join('')}</ul>
    <div class="toolbar"><input id="new-cat" placeholder="New category name" aria-label="New category name"><button class="btn" data-act="cat-add" type="button">+ Add category</button></div>`;
}

/* ---------- Top products ---------- */
function topTab() {
  const top = S.cat.topProducts;
  const available = S.cat.products.filter((p) => p.active && !top.includes(p.code));
  return `<p class="muted">Choose which products appear in “Top Products” on the home page, in this order.</p>
    ${top.length ? `<ol class="rows">${top.map((code, i) => {
    const p = S.cat.products.find((x) => x.code === code);
    return `<li class="row"><div class="grow"><strong>${esc(p ? p.name : code)}</strong><small>Code: ${esc(code)}${p && !p.active ? ' · hidden' : ''}${p ? '' : ' · missing'}</small></div>
      <div class="mini-btns"><button class="btn small ghost" data-act="top-up" data-i="${i}" type="button" aria-label="Move up">↑</button><button class="btn small ghost" data-act="top-down" data-i="${i}" type="button" aria-label="Move down">↓</button><button class="btn small ghost" data-act="top-del" data-i="${i}" type="button">Remove</button></div></li>`;
  }).join('')}</ol>` : '<p class="muted">Nothing selected yet. Until you choose products, the home page shows your first few products instead.</p>'}
    <div class="toolbar"><select id="top-add" aria-label="Product to add"><option value="">Choose a product…</option>${available.map((p) => `<option value="${esc(p.code)}">${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select><button class="btn" data-act="top-add" type="button">+ Add to Top Products</button></div>`;
}

/* ---------- Banners ---------- */
function bannersTab() {
  const bs = S.cat.banners;
  return `<p class="muted">Promotional banners rotate at the top of the home page. Use wide images (about 1600×700). Hide a banner to unpublish it.</p>
    <ul class="banner-list">${bs.map((b, i) => `<li class="card banner">
      ${b.image ? `<img class="banner-img" src="${esc(imgSrc(b.image))}" alt="Banner ${i + 1} preview">` : '<div class="banner-img none">No image yet</div>'}
      <div class="form">
        <label>Title<input data-b="title" data-i="${i}" value="${esc(b.title)}"></label>
        <label>Subtitle<input data-b="subtitle" data-i="${i}" value="${esc(b.subtitle)}"></label>
        <div class="two"><label>Button text<input data-b="buttonText" data-i="${i}" value="${esc(b.buttonText)}" placeholder="e.g. Shop now"></label>
        <label>Link<input data-b="link" data-i="${i}" value="${esc(b.link)}" placeholder="#/shop or https://…"></label></div>
        <label class="check"><input type="checkbox" data-b="active" data-i="${i}" ${b.active ? 'checked' : ''}> Published</label>
        <label class="file">${b.image ? 'Replace image' : 'Add image'}<input type="file" accept="image/jpeg,image/png,image/webp" data-banner-file="${i}"></label>
        <div class="mini-btns"><button class="btn small ghost" data-act="b-up" data-i="${i}" type="button">↑ Earlier</button><button class="btn small ghost" data-act="b-down" data-i="${i}" type="button">↓ Later</button></div>
      </div></li>`).join('')}</ul>
    ${bs.length ? '' : '<p class="muted">No banners yet.</p>'}
    <button class="btn" data-act="b-add" type="button">+ Add banner</button>`;
}

/* ---------- Settings ---------- */
function settingsTab() {
  const s = S.cat.settings;
  const input = (key, label, attrs = '') => `<label>${label}<input data-s="${key}" value="${esc(s[key])}" ${attrs}></label>`;
  return `<form class="form" id="sform" novalidate><h2>Shop details</h2>
    <div class="logo-row"><img src="${esc(imgSrc(s.logo || 'images/logo.png'))}" alt="Current logo" class="logo-prev"><label class="file">Replace logo<input type="file" id="logo-file" accept="image/jpeg,image/png,image/webp"></label></div>
    ${input('shopName', 'Shop name')}
    ${input('tagline', 'Tagline (English)')}
    ${input('taglineSi', 'Tagline (Sinhala)')}
    ${input('whatsapp', 'Business WhatsApp number (with country code)', 'inputmode="tel" placeholder="94742899909"')}
    <p class="muted tiny" id="wa-preview">Orders open: https://wa.me/${esc(waDigits(s.whatsapp))} (${esc(displayPhone(s.whatsapp))})</p>
    ${input('facebook', 'Facebook page link', 'placeholder="https://www.facebook.com/…"')}
    <div class="two">${input('phone', 'Phone number for calls (optional)', 'inputmode="tel"')}${input('phone2', 'Second phone number (optional)', 'inputmode="tel"')}</div>
    ${input('email', 'Email (optional)', 'type="email"')}
    ${input('address', 'Shop address (optional)')}
    ${input('announcement', 'Announcement bar text (optional, shown at the very top)')}
    <label>Delivery note shown at checkout<textarea data-s="deliveryNote" rows="2">${esc(s.deliveryNote)}</textarea></label>
  </form>`;
}

/* ---------- event wiring ---------- */
function bindContent() {
  const c = document.getElementById('content');

  c.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'pfilter') { S.filter = t.value; const pos = t.selectionStart; renderTab(); const n = document.getElementById('pfilter'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (t.dataset.f && S.editing) { S.editing.draft[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; return; }
    if (t.dataset.o && S.editing) { S.editing.draft.options[Number(t.dataset.i)][t.dataset.o] = t.value; return; }
    if (t.dataset.s) {
      S.cat.settings[t.dataset.s] = t.value; markDirty();
      if (t.dataset.s === 'whatsapp') document.getElementById('wa-preview').textContent = `Orders open: https://wa.me/${waDigits(t.value)} (${displayPhone(t.value)})`;
      return;
    }
    if (t.dataset.cat) { const cat = S.cat.categories[Number(t.dataset.i)]; cat[t.dataset.cat] = t.type === 'checkbox' ? t.checked : t.value; markDirty(); return; }
    if (t.dataset.b && t.type !== 'file') { const b = S.cat.banners[Number(t.dataset.i)]; b[t.dataset.b] = t.type === 'checkbox' ? t.checked : t.value; markDirty(); }
  });

  c.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.id === 'pimg' && S.editing) {
        const code = (S.editing.draft.code || 'item').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        for (const file of t.files) {
          const res = await processImage(file, { maxW: 1400 });
          const path = `images/products/${code}-${uid()}.${res.ext}`;
          addPending(path, res); S.editing.draft.images.push(path);
        }
        renderTab();
      }
      if (t.dataset.bannerFile !== undefined) {
        const i = Number(t.dataset.bannerFile);
        const res = await processImage(t.files[0], { maxW: 1800 });
        const path = `images/banners/b-${uid()}.${res.ext}`;
        addPending(path, res); S.cat.banners[i].image = path; markDirty(); renderTab();
      }
      if (t.id === 'logo-file') {
        const res = await processImage(t.files[0], { maxW: 800, png: true });
        const path = `images/logo-${uid()}.${res.ext}`;
        addPending(path, res); S.cat.settings.logo = path; markDirty(); renderTab();
      }
    } catch (ex) { toast(friendly(ex), 'err'); t.value = ''; }
  });

  c.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = Number(b.dataset.i);
    const act = b.dataset.act;
    const d = S.editing && S.editing.draft;
    switch (act) {
      case 'new-product': S.editing = { index: -1, draft: newProductDraft() }; renderTab(); window.scrollTo(0, 0); break;
      case 'edit-product': S.editing = { index: i, draft: structuredClone(S.cat.products[i]) }; renderTab(); window.scrollTo(0, 0); break;
      case 'toggle-product': S.cat.products[i].active = !S.cat.products[i].active; markDirty(); renderTab(); break;
      case 'product-cancel': S.editing = null; renderTab(); break;
      case 'product-done': if (applyProductDraft()) { renderTab(); window.scrollTo(0, 0); } break;
      case 'opt-add': d.options.push({ id: '', label: '', size: '', price: null, minQty: 1 }); renderTab(); break;
      case 'opt-del': d.options.splice(i, 1); renderTab(); break;
      case 'opt-up': move(d.options, i, -1); renderTab(); break;
      case 'opt-down': move(d.options, i, 1); renderTab(); break;
      case 'img-main': d.images.unshift(d.images.splice(i, 1)[0]); renderTab(); break;
      case 'img-left': move(d.images, i, -1); renderTab(); break;
      case 'img-right': move(d.images, i, 1); renderTab(); break;
      case 'img-del': d.images.splice(i, 1); renderTab(); break;
      case 'cat-up': move(S.cat.categories, i, -1); markDirty(); renderTab(); break;
      case 'cat-down': move(S.cat.categories, i, 1); markDirty(); renderTab(); break;
      case 'cat-add': {
        const input = document.getElementById('new-cat');
        const name = input.value.trim();
        if (!name) { toast('Please type a category name.', 'err'); break; }
        let id = slugify(name);
        while (S.cat.categories.some((x) => x.id === id)) id += `-${uid().slice(-3)}`;
        S.cat.categories.push({ id, name, active: true, order: S.cat.categories.length });
        markDirty(); renderTab(); break;
      }
      case 'top-up': move(S.cat.topProducts, i, -1); markDirty(); renderTab(); break;
      case 'top-down': move(S.cat.topProducts, i, 1); markDirty(); renderTab(); break;
      case 'top-del': S.cat.topProducts.splice(i, 1); markDirty(); renderTab(); break;
      case 'top-add': {
        const v = document.getElementById('top-add').value;
        if (!v) { toast('Choose a product first.', 'err'); break; }
        S.cat.topProducts.push(v); markDirty(); renderTab(); break;
      }
      case 'b-up': move(S.cat.banners, i, -1); markDirty(); renderTab(); break;
      case 'b-down': move(S.cat.banners, i, 1); markDirty(); renderTab(); break;
      case 'b-add':
        S.cat.banners.push({ id: `b${uid()}`, image: '', title: '', subtitle: '', buttonText: '', link: '', active: true, order: S.cat.banners.length });
        markDirty(); renderTab(); break;
      default: break;
    }
  });
}

/* ---------- start ---------- */
if (!store) {
  $screen.innerHTML = '<section class="auth card"><h1>Browser storage is blocked</h1><p>Please turn off private browsing or allow site data, then reload this page.</p></section>';
} else if (store.getItem(VAULT_KEY)) showLogin(); else showSetup();
