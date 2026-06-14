function parseMoneyToCents(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = String(value || '')
    .replace(/[₹$,]/g, '')
    .trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

function formatInr(cents) {
  const rupees = (Number(cents || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `₹${rupees}`;
}

function toInrCents(amountCents, currency, exchangeRate) {
  return Math.round(amountCents * exchangeRate);
}

module.exports = { parseMoneyToCents, formatInr, toInrCents };
