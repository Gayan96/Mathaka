// Small shared helpers (used by the storefront, the admin and the tests).

/** Format a number as LKR, e.g. 1500 -> "Rs. 1,500", 1500.5 -> "Rs. 1,500.50". Returns null when unset. */
export function fmtRs(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  const hasDecimals = Math.round(v * 100) % 100 !== 0;
  return 'Rs. ' + v.toLocaleString('en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Escape text for safe use inside HTML text or attribute values. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Turn a name into a url-safe id, e.g. "Photo Collages" -> "photo-collages". */
export function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Digits only version of a phone number; a leading 0 becomes the Sri Lankan 94 prefix. */
export function waDigits(num) {
  let d = String(num || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '94' + d.slice(1);
  return d;
}

/** Friendly display of a Sri Lankan number: 94742899909 -> "+94 74 289 9909". */
export function displayPhone(num) {
  const d = waDigits(num);
  if (/^94\d{9}$/.test(d)) return `+94 ${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d ? '+' + d : '';
}
