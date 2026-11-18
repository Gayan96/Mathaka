// Catalogue loading and product helpers. All shop data lives in data/catalog.json.

export const STOCK = {
  in_stock: { label: 'In stock', orderable: true },
  low_stock: { label: 'Low stock', orderable: true },
  made_to_order: { label: 'Made to order', orderable: true },
  out_of_stock: { label: 'Out of stock', orderable: false },
};

export const DEFAULT_SETTINGS = {
  shopName: 'Mathaka Gift Shop',
  tagline: 'Gift More Than Just Things…',
  taglineSi: 'ඔබේ මතකයන්ට ආදරණීය රාමුවක්…',
  logo: 'images/logo.png',
  whatsapp: '94742899909',
  facebook: 'https://www.facebook.com/mathakagift/',
  phone: '',
  phone2: '',
  email: '',
  address: '',
  announcement: '',
  deliveryNote: 'Delivery charges will be confirmed with you on WhatsApp.',
};

export function normalize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULT_SETTINGS, ...(c.settings || {}) };
  const categories = (c.categories || []).map((x, i) => ({
    id: String(x.id), name: String(x.name || x.id), active: x.active !== false, order: Number.isFinite(x.order) ? x.order : i,
  })).sort((a, b) => a.order - b.order);
  const products = (c.products || []).map((p) => ({
    code: String(p.code),
    name: String(p.name || p.code),
    categoryId: p.categoryId || '',
    price: p.price === null || p.price === undefined || p.price === '' ? null : Number(p.price),
    description: p.description || '',
    stock: STOCK[p.stock] ? p.stock : 'in_stock',
    stockQty: p.stockQty === null || p.stockQty === undefined || p.stockQty === '' ? null : Number(p.stockQty),
    minQty: Math.max(1, parseInt(p.minQty, 10) || 1),
    active: p.active !== false,
    customPrint: !!p.customPrint,
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
    options: Array.isArray(p.options) ? p.options.map((o, i) => ({
      id: String(o.id || `opt${i + 1}`),
      label: String(o.label || `Option ${i + 1}`),
      size: o.size || '',
      price: o.price === null || o.price === undefined || o.price === '' ? null : Number(o.price),
      minQty: Math.max(1, parseInt(o.minQty, 10) || 1),
    })) : [],
    note: p.note || '',
  }));
  const banners = (c.banners || []).map((b, i) => ({
    id: String(b.id || `b${i + 1}`),
    image: b.image || '',
    title: b.title || '',
    subtitle: b.subtitle || '',
    buttonText: b.buttonText || '',
    link: b.link || '',
    active: b.active !== false,
    order: Number.isFinite(b.order) ? b.order : i,
  })).sort((a, b) => a.order - b.order);
  const topProducts = Array.isArray(c.topProducts) ? c.topProducts.map(String) : [];
  return { settings, categories, products, banners, topProducts };
}

export async function loadCatalog(base = '') {
  const r = await fetch(`${base}data/catalog.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load the product catalogue.');
  return normalize(await r.json());
}

export const findProduct = (cat, code) => cat.products.find((p) => p.code === code);
export const findOption = (p, id) => (p && id ? p.options.find((o) => o.id === id) : undefined);
export const visibleProducts = (cat) => cat.products.filter((p) => p.active);
export const activeCategories = (cat) => cat.categories.filter((c) => c.active);
export const isOrderable = (p) => STOCK[p.stock].orderable && !(p.stockQty !== null && p.stockQty <= 0 && p.stock !== 'made_to_order');

/** Price of one unit for a product + option. null means "price not set / ask on WhatsApp". */
export function unitPrice(p, optionId) {
  const o = findOption(p, optionId);
  if (o && o.price !== null) return o.price;
  return p.price;
}

export function minQtyFor(p, optionId) {
  const o = findOption(p, optionId);
  return Math.max(1, (o && o.minQty) || p.minQty || 1);
}

/** Lowest price shown on listing cards, with a flag when options differ. */
export function listingPrice(p) {
  const prices = [];
  if (p.price !== null) prices.push(p.price);
  p.options.forEach((o) => { if (o.price !== null) prices.push(o.price); });
  if (!prices.length) return { price: null, from: false };
  const min = Math.min(...prices);
  return { price: min, from: p.options.length > 0 && new Set(prices).size > 1 };
}

export function searchProducts(cat, { q = '', categoryId = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return visibleProducts(cat).filter((p) => {
    if (categoryId && p.categoryId !== categoryId) return false;
    if (!needle) return true;
    return p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle);
  });
}
