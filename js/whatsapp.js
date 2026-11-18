// Checkout validation and the WhatsApp click-to-chat message.
import { fmtRs, waDigits } from './util.js';

const PHONE_RE = /^\+?\d{9,15}$/;
const POSTAL_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{2,9}$/;

export function validateCheckout(f) {
  const errors = {};
  const name = (f.name || '').trim();
  const phone = (f.phone || '').replace(/[\s\-().]/g, '');
  const address = (f.address || '').trim();
  const city = (f.city || '').trim();
  const postal = (f.postal || '').trim();
  if (name.length < 2) errors.name = 'Please enter your full name.';
  if (!PHONE_RE.test(phone)) errors.phone = 'Enter a valid WhatsApp number, e.g. 0771234567 or +94771234567.';
  if (address.length < 5) errors.address = 'Please enter your delivery address.';
  if (city.length < 2) errors.city = 'Please enter your city or town.';
  if (!POSTAL_RE.test(postal)) errors.postal = 'Please enter your postal / ZIP code.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Line total text for the message: "Rs. 3,000" or "Rs. TBC" when the price is not set. */
function lineTotalText(line) {
  const t = fmtRs(line.total);
  return t || 'Rs. TBC (price to be confirmed)';
}

export function buildMessage({ shopName, customer, lines, subtotal, unpricedCount = 0, notes }) {
  const addr = [customer.address.trim(), customer.city.trim()].filter(Boolean).join(', ');
  const items = lines.map((l, i) => (
    `${i + 1}. ${l.name} | Code: ${l.code} | Option: ${l.optionLabel || '-'} | Qty: ${l.qty} | ${lineTotalText(l)}`
  ));
  let subtotalText = fmtRs(subtotal) || 'Rs. 0';
  if (unpricedCount > 0) subtotalText += ` (excludes ${unpricedCount} item${unpricedCount > 1 ? 's' : ''} with price to be confirmed)`;
  return [
    `Hi ${shopName}! I’d like to place an order.`,
    '',
    `Customer name: ${customer.name.trim()}`,
    `Customer WhatsApp number: ${customer.phone.trim()}`,
    `Delivery address: ${addr}`,
    `Postal code: ${customer.postal.trim()}`,
    '',
    'Items:',
    ...items,
    '',
    `Product subtotal: ${subtotalText}`,
    `Order notes: ${(notes || '').trim() || 'None'}`,
  ].join('\n');
}

/** https://wa.me/<number>?text=<url-encoded message> */
export function waLink(number, message) {
  const digits = waDigits(number);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
