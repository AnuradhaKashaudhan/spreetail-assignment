const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { parseMoneyToCents, toInrCents } = require('./money');

const NAME_ALIASES = {
  date: ['date', 'expense date', 'spent on', 'paid on', 'transaction date'],
  description: ['description', 'expense', 'item', 'notes', 'note', 'merchant'],
  amount: ['amount', 'total', 'cost', 'value'],
  currency: ['currency', 'curr'],
  exchangeRate: ['exchange_rate', 'exchange rate', 'fx rate', 'rate', 'conversion rate'],
  paidBy: ['paid_by', 'paid by', 'payer', 'paidby', 'who paid'],
  paidTo: ['paid_to', 'paid to', 'payee', 'received by', 'settled with'],
  splitType: ['split_type', 'split type', 'split', 'type'],
  participants: ['participants', 'split_between', 'split between', 'members', 'people', 'shared by'],
  shares: ['shares', 'split_details', 'split details', 'details', 'breakdown'],
  category: ['category', 'kind']
};

const SUPPORTED_SPLITS = new Set(['equal', 'exact', 'percentage', 'shares']);
const CURRENCY_RATES = { INR: 1 };

function importCsv(db, { groupId, uploadedByUserId, filename, csvText, defaultUsdRate = 83.25 }) {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  });

  const importRow = db.prepare(`
    INSERT INTO imports (group_id, filename, uploaded_by_user_id, default_usd_rate, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, filename, uploadedByUserId, Number(defaultUsdRate), rows.length);
  const importId = importRow.lastInsertRowid;

  const ctx = buildContext(db, groupId, defaultUsdRate);
  const anomalies = [];
  let importedExpenseCount = 0;
  let importedSettlementCount = 0;
  let skippedCount = 0;

  const tx = db.transaction(() => {
    rows.forEach((raw, index) => {
      const rowNumber = index + 2;
      const normalized = normalizeRow(raw);
      const rowAnomalies = [];
      const result = parseRow(normalized, raw, rowNumber, ctx, rowAnomalies);
      anomalies.push(...rowAnomalies);

      if (!result.ok) {
        skippedCount += 1;
        return;
      }

      if (result.kind === 'settlement') {
        insertSettlement(db, importId, groupId, rowNumber, result.value, raw);
        importedSettlementCount += 1;
        return;
      }

      const duplicate = findDuplicate(db, groupId, result.value, raw);
      if (duplicate) {
        anomalies.push(anomaly(rowNumber, 'error', duplicate.code, duplicate.message, duplicate.policy, duplicate.action, raw));
        skippedCount += 1;
        return;
      }

      const expenseId = insertExpense(db, importId, groupId, rowNumber, result.value, raw);
      for (const share of result.value.shares) {
        db.prepare(`
          INSERT INTO expense_shares (expense_id, user_id, share_cents, basis)
          VALUES (?, ?, ?, ?)
        `).run(expenseId, share.userId, share.shareCents, share.basis);
      }
      importedExpenseCount += 1;
    });

    const insertAnomaly = db.prepare(`
      INSERT INTO import_anomalies
        (import_id, row_number, severity, code, message, policy, action_taken, raw_row_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of anomalies) {
      insertAnomaly.run(
        importId,
        item.rowNumber,
        item.severity,
        item.code,
        item.message,
        item.policy,
        item.actionTaken,
        JSON.stringify(item.rawRow)
      );
    }

    db.prepare(`
      UPDATE imports
      SET imported_expense_count = ?,
          imported_settlement_count = ?,
          skipped_count = ?,
          anomaly_count = ?
      WHERE id = ?
    `).run(importedExpenseCount, importedSettlementCount, skippedCount, anomalies.length, importId);
  });

  tx();
  return getImportReport(db, importId);
}

function buildContext(db, groupId, defaultUsdRate) {
  const users = db.prepare('SELECT id, name FROM users').all();
  const usersByName = new Map(users.map((user) => [canonical(user.name), user]));
  const memberships = db.prepare(`
    SELECT gm.*, u.name
    FROM group_memberships gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_on
  `).all(groupId);
  return { usersByName, memberships, defaultUsdRate: Number(defaultUsdRate) || 83.25 };
}

function normalizeRow(raw) {
  const lowered = {};
  for (const [key, value] of Object.entries(raw)) {
    lowered[key.toLowerCase().trim()] = value;
  }
  const normalized = {};
  for (const [target, aliases] of Object.entries(NAME_ALIASES)) {
    normalized[target] = firstPresent(lowered, aliases);
  }
  normalized.raw = raw;
  return normalized;
}

function parseRow(row, raw, rowNumber, ctx, rowAnomalies) {
  const date = parseDate(row.date);
  if (!date) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'INVALID_DATE', 'Missing or invalid expense date.', 'Rows without a reliable date are not imported.', 'Skipped row.', raw));
    return { ok: false };
  }
  if (date > todayIso()) {
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'FUTURE_DATE', `Expense date ${date} is in the future.`, 'Future-dated rows are imported but flagged for review.', 'Imported and flagged.', raw));
  }

  const amountCents = parseMoneyToCents(row.amount);
  if (amountCents === null) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'INVALID_AMOUNT', 'Missing or non-numeric amount.', 'Rows without a numeric amount are not imported.', 'Skipped row.', raw));
    return { ok: false };
  }
  if (amountCents === 0) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'ZERO_AMOUNT', 'Amount is zero.', 'Zero-value rows do not affect balances and are not imported.', 'Skipped row.', raw));
    return { ok: false };
  }
  if (amountCents < 0) {
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'NEGATIVE_AMOUNT', 'Amount is negative; treated as a refund/credit.', 'Negative expenses are imported as credits with the same split.', 'Imported as negative expense.', raw));
  }

  const paidBy = resolveUser(row.paidBy, ctx);
  if (!paidBy) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'UNKNOWN_PAYER', `Payer "${row.paidBy || ''}" is not a known member.`, 'Unknown payers are not guessed.', 'Skipped row.', raw));
    return { ok: false };
  }

  const description = String(row.description || '').trim() || '(no description)';
  const splitType = canonicalSplit(row.splitType);
  const currency = parseCurrency(row.currency);
  const exchangeRate = parseExchangeRate(row.exchangeRate, currency, ctx, rowNumber, raw, rowAnomalies);
  if (!exchangeRate) return { ok: false };
  const amountInrCents = toInrCents(amountCents, currency, exchangeRate);

  if (isSettlementRow(row, description)) {
    const paidTo = resolveUser(row.paidTo || firstOtherParticipant(row, paidBy.name), ctx);
    if (!paidTo) {
      rowAnomalies.push(anomaly(rowNumber, 'error', 'SETTLEMENT_PAYEE_UNKNOWN', 'Settlement-like row has no known payee.', 'Settlement rows require both sides.', 'Skipped row.', raw));
      return { ok: false };
    }
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'SETTLEMENT_LOGGED_AS_EXPENSE', 'Payment/settlement row was found in the expenses export.', 'Settlement-like rows are converted to settlements instead of shared expenses.', 'Imported as settlement.', raw));
    return {
      ok: true,
      kind: 'settlement',
      value: { date, payerUserId: paidBy.id, payeeUserId: paidTo.id, amountCents, currency, exchangeRate, amountInrCents, note: description }
    };
  }

  if (!SUPPORTED_SPLITS.has(splitType)) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'INVALID_SPLIT_TYPE', `Unsupported split type "${row.splitType || ''}".`, 'Only equal, exact, percentage, and shares splits are imported.', 'Skipped row.', raw));
    return { ok: false };
  }

  if (!isActiveMember(ctx, paidBy.id, date)) {
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'PAYER_NOT_ACTIVE', `${paidBy.name} was not active in the group on ${date}.`, 'Rows paid by inactive known users are imported and flagged because guests can pay during trips.', 'Imported and flagged.', raw));
  }

  const shares = buildShares(row, splitType, amountInrCents, currency, exchangeRate, date, ctx, raw, rowNumber, rowAnomalies);
  if (!shares.ok) return { ok: false };

  return {
    ok: true,
    kind: 'expense',
    value: {
      date,
      description,
      paidByUserId: paidBy.id,
      amountCents,
      currency,
      exchangeRate,
      amountInrCents,
      splitType,
      shares: shares.value
    }
  };
}

function buildShares(row, splitType, amountInrCents, currency, exchangeRate, date, ctx, raw, rowNumber, rowAnomalies) {
  const participants = parsePeople(row.participants)
    .map((name) => resolveUser(name, ctx))
    .filter(Boolean);
  const activeParticipants = participants.length > 0
    ? participants
    : activeUsersOnDate(ctx, date);

  if (activeParticipants.length === 0) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'EMPTY_PARTICIPANTS', 'No participants could be resolved for the expense.', 'Participant lists are not guessed beyond active group membership on the expense date.', 'Skipped row.', raw));
    return { ok: false };
  }

  for (const participant of activeParticipants) {
    if (!isActiveMember(ctx, participant.id, date)) {
      rowAnomalies.push(anomaly(rowNumber, 'warning', 'INACTIVE_MEMBER_INCLUDED', `${participant.name} was included but was not active on ${date}.`, 'Explicit splits are honored even if membership dates disagree, then flagged for review.', 'Imported with explicit member share.', raw));
    }
  }

  if (splitType === 'equal') {
    return { ok: true, value: splitEvenly(activeParticipants, amountInrCents) };
  }

  const parsed = parseShareMap(row.shares);
  if (parsed.size === 0) {
    rowAnomalies.push(anomaly(rowNumber, 'error', 'MISSING_SPLIT_DETAILS', `${splitType} split has no details.`, 'Non-equal splits require per-person values.', 'Skipped row.', raw));
    return { ok: false };
  }

  const shares = [];
  if (splitType === 'exact') {
    let total = 0;
    for (const [name, value] of parsed) {
      const user = resolveUser(name, ctx);
      const cents = parseMoneyToCents(value);
      if (!user || cents === null) continue;
      const inrShare = toInrCents(cents, currency, exchangeRate);
      total += inrShare;
      shares.push({ userId: user.id, shareCents: inrShare, basis: `exact:${value}` });
    }
    validateShareTotal(total, amountInrCents, rowNumber, raw, rowAnomalies);
    return shares.length ? { ok: true, value: shares } : { ok: false };
  }

  if (splitType === 'percentage') {
    let percentTotal = 0;
    for (const [name, value] of parsed) {
      const user = resolveUser(name, ctx);
      const percent = Number(String(value).replace('%', '').trim());
      if (!user || !Number.isFinite(percent)) continue;
      percentTotal += percent;
      shares.push({ userId: user.id, shareCents: Math.round(amountInrCents * percent / 100), basis: `percentage:${percent}` });
    }
    if (Math.abs(percentTotal - 100) > 0.01) {
      rowAnomalies.push(anomaly(rowNumber, 'warning', 'PERCENT_TOTAL_MISMATCH', `Percent split totals ${percentTotal}%, not 100%.`, 'Percent splits are normalized to the declared percentages, with the final rounding adjustment applied to the largest share.', 'Imported with rounding adjustment.', raw));
    }
    adjustRounding(shares, amountInrCents);
    return shares.length ? { ok: true, value: shares } : { ok: false };
  }

  let unitTotal = 0;
  const weighted = [];
  for (const [name, value] of parsed) {
    const user = resolveUser(name, ctx);
    const units = Number(value);
    if (!user || !Number.isFinite(units) || units <= 0) continue;
    unitTotal += units;
    weighted.push({ user, units });
  }
  for (const item of weighted) {
    shares.push({ userId: item.user.id, shareCents: Math.round(amountInrCents * item.units / unitTotal), basis: `shares:${item.units}` });
  }
  adjustRounding(shares, amountInrCents);
  return shares.length ? { ok: true, value: shares } : { ok: false };
}

function insertExpense(db, importId, groupId, rowNumber, expense, raw) {
  const fingerprint = fingerprintExpense(expense);
  const result = db.prepare(`
    INSERT INTO expenses
      (group_id, import_id, source_row_number, source_fingerprint, expense_date, description,
       paid_by_user_id, amount_cents, currency, exchange_rate_to_inr, amount_inr_cents, split_type, raw_row_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    groupId,
    importId,
    rowNumber,
    fingerprint,
    expense.date,
    expense.description,
    expense.paidByUserId,
    expense.amountCents,
    expense.currency,
    expense.exchangeRate,
    expense.amountInrCents,
    expense.splitType,
    JSON.stringify(raw)
  );
  return result.lastInsertRowid;
}

function insertSettlement(db, importId, groupId, rowNumber, settlement, raw) {
  db.prepare(`
    INSERT INTO settlements
      (group_id, import_id, source_row_number, settlement_date, payer_user_id, payee_user_id,
       amount_cents, currency, exchange_rate_to_inr, amount_inr_cents, note, raw_row_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    groupId,
    importId,
    rowNumber,
    settlement.date,
    settlement.payerUserId,
    settlement.payeeUserId,
    settlement.amountCents,
    settlement.currency,
    settlement.exchangeRate,
    settlement.amountInrCents,
    settlement.note,
    JSON.stringify(raw)
  );
}

function findDuplicate(db, groupId, expense, raw) {
  const exact = db.prepare(`
    SELECT id FROM expenses WHERE group_id = ? AND source_fingerprint = ?
  `).get(groupId, fingerprintExpense(expense));
  if (exact) {
    return {
      code: 'EXACT_DUPLICATE',
      message: 'Exact duplicate of an already imported expense.',
      policy: 'Exact duplicate rows are not imported twice. They stay visible in the import report for approval.',
      action: 'Skipped duplicate row.'
    };
  }

  const conflicting = db.prepare(`
    SELECT id, amount_inr_cents FROM expenses
    WHERE group_id = ? AND expense_date = ? AND lower(description) = lower(?) AND paid_by_user_id = ?
    LIMIT 1
  `).get(groupId, expense.date, expense.description, expense.paidByUserId);
  if (conflicting && conflicting.amount_inr_cents !== expense.amountInrCents) {
    return {
      code: 'CONFLICTING_DUPLICATE',
      message: 'Possible duplicate has same date, description, and payer but a different amount.',
      policy: 'Conflicting duplicate rows are not auto-merged or overwritten.',
      action: 'Skipped later conflicting row for manual review.'
    };
  }
  return null;
}

function getImportReport(db, importId) {
  const summary = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId);
  const anomalies = db.prepare('SELECT * FROM import_anomalies WHERE import_id = ? ORDER BY row_number, id').all(importId);
  return { summary, anomalies };
}

function anomaly(rowNumber, severity, code, message, policy, actionTaken, rawRow) {
  return { rowNumber, severity, code, message, policy, actionTaken, rawRow };
}

function firstPresent(source, aliases) {
  for (const alias of aliases) {
    if (source[alias] !== undefined && String(source[alias]).trim() !== '') return source[alias];
  }
  return '';
}

function canonical(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveUser(value, ctx) {
  return ctx.usersByName.get(canonical(value));
}

function canonicalSplit(value) {
  const split = String(value || 'equal').toLowerCase().trim();
  if (['equally', 'even', 'split equally'].includes(split)) return 'equal';
  if (['unequal', 'amount', 'exact amounts'].includes(split)) return 'exact';
  if (['percent', 'percentages'].includes(split)) return 'percentage';
  if (['share', 'weighted'].includes(split)) return 'shares';
  return split || 'equal';
}

function parseCurrency(value) {
  const currency = String(value || 'INR').trim().toUpperCase();
  if (['₹', 'RS', 'RUPEE', 'RUPEES'].includes(currency)) return 'INR';
  if (['$', 'DOLLAR', 'DOLLARS', 'US DOLLAR', 'US DOLLARS'].includes(currency)) return 'USD';
  return currency;
}

function parseExchangeRate(value, currency, ctx, rowNumber, raw, rowAnomalies) {
  if (currency === 'INR') return 1;
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (currency === 'USD') {
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'MISSING_EXCHANGE_RATE', `USD row has no exchange rate.`, 'USD rows use the import form default rate and are flagged.', `Used USD rate ${ctx.defaultUsdRate}.`, raw));
    return ctx.defaultUsdRate;
  }
  rowAnomalies.push(anomaly(rowNumber, 'error', 'UNKNOWN_CURRENCY', `Currency "${currency}" has no configured exchange rate.`, 'Unknown currencies are not converted silently.', 'Skipped row.', raw));
  return null;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return null;
  const year = match[3] ? normalizeYear(match[3]) : '2026';
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function normalizeYear(value) {
  const year = String(value);
  return year.length === 2 ? `20${year}` : year;
}

function parsePeople(value) {
  return String(value || '')
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseShareMap(value) {
  const text = String(value || '').trim();
  const map = new Map();
  if (!text) return map;
  try {
    const parsed = JSON.parse(text);
    for (const [name, share] of Object.entries(parsed)) map.set(name, share);
    return map;
  } catch {
    // Continue with forgiving "Aisha: 50; Rohan: 50" parsing.
  }
  for (const part of text.split(/[;,|]/)) {
    const [name, share] = part.split(/[:=]/);
    if (name && share) map.set(name.trim(), share.trim());
  }
  return map;
}

function activeUsersOnDate(ctx, date) {
  const byId = new Map();
  for (const membership of ctx.memberships) {
    if (membership.joined_on <= date && (!membership.left_on || membership.left_on >= date)) {
      byId.set(membership.user_id, { id: membership.user_id, name: membership.name });
    }
  }
  return [...byId.values()];
}

function isActiveMember(ctx, userId, date) {
  return ctx.memberships.some((membership) => (
    membership.user_id === userId &&
    membership.joined_on <= date &&
    (!membership.left_on || membership.left_on >= date)
  ));
}

function splitEvenly(users, amountInrCents) {
  const base = Math.trunc(amountInrCents / users.length);
  let remainder = amountInrCents - base * users.length;
  return users.map((user) => {
    const adjustment = remainder === 0 ? 0 : Math.sign(remainder);
    remainder -= adjustment;
    return { userId: user.id, shareCents: base + adjustment, basis: 'equal' };
  });
}

function validateShareTotal(total, expected, rowNumber, raw, rowAnomalies) {
  if (Math.abs(total - expected) > 1) {
    rowAnomalies.push(anomaly(rowNumber, 'warning', 'SPLIT_TOTAL_MISMATCH', 'Exact split total does not match the expense amount.', 'Exact split details are kept as entered so the discrepancy remains visible.', 'Imported with entered shares.', raw));
  }
}

function adjustRounding(shares, targetTotal) {
  const current = shares.reduce((sum, share) => sum + share.shareCents, 0);
  const difference = targetTotal - current;
  if (difference === 0 || shares.length === 0) return;
  shares.sort((a, b) => Math.abs(b.shareCents) - Math.abs(a.shareCents))[0].shareCents += difference;
}

function isSettlementRow(row, description) {
  const kind = String(row.category || row.splitType || '').toLowerCase();
  const text = `${kind} ${description}`.toLowerCase();
  return /\b(settle|settlement|paid back|reimburse|reimbursement|transfer)\b/.test(text);
}

function firstOtherParticipant(row, payerName) {
  return parsePeople(row.participants).find((name) => canonical(name) !== canonical(payerName));
}

function fingerprintExpense(expense) {
  const input = [
    expense.date,
    expense.description.toLowerCase().trim(),
    expense.paidByUserId,
    expense.amountInrCents,
    expense.currency,
    expense.splitType,
    expense.shares.map((share) => `${share.userId}:${share.shareCents}`).sort().join('|')
  ].join('::');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { importCsv, getImportReport, parseDate, normalizeRow };
