function calculateBalances(db, groupId) {
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.name
    FROM users u
    JOIN group_memberships gm ON gm.user_id = u.id
    WHERE gm.group_id = ?
    ORDER BY u.name
  `).all(groupId);
  const ledger = new Map(users.map((user) => [user.id, { user, netCents: 0, lines: [] }]));

  const expenses = db.prepare(`
    SELECT e.*, payer.name AS payer_name
    FROM expenses e
    JOIN users payer ON payer.id = e.paid_by_user_id
    WHERE e.group_id = ? AND e.status = 'active'
    ORDER BY e.expense_date, e.id
  `).all(groupId);

  const sharesByExpense = db.prepare(`
    SELECT es.*, u.name
    FROM expense_shares es
    JOIN users u ON u.id = es.user_id
    WHERE es.expense_id = ?
    ORDER BY u.name
  `);

  for (const expense of expenses) {
    ensureLedger(ledger, expense.paid_by_user_id, expense.payer_name);
    addLine(ledger, expense.paid_by_user_id, expense.amount_inr_cents, {
      type: 'paid',
      date: expense.expense_date,
      description: expense.description,
      expenseId: expense.id,
      detail: `Paid ${expense.currency} ${(expense.amount_cents / 100).toFixed(2)}`
    });

    for (const share of sharesByExpense.all(expense.id)) {
      ensureLedger(ledger, share.user_id, share.name);
      addLine(ledger, share.user_id, -share.share_cents, {
        type: 'share',
        date: expense.expense_date,
        description: expense.description,
        expenseId: expense.id,
        detail: share.basis
      });
    }
  }

  const settlements = db.prepare(`
    SELECT s.*, payer.name AS payer_name, payee.name AS payee_name
    FROM settlements s
    JOIN users payer ON payer.id = s.payer_user_id
    JOIN users payee ON payee.id = s.payee_user_id
    WHERE s.group_id = ?
    ORDER BY s.settlement_date, s.id
  `).all(groupId);

  for (const settlement of settlements) {
    ensureLedger(ledger, settlement.payer_user_id, settlement.payer_name);
    ensureLedger(ledger, settlement.payee_user_id, settlement.payee_name);
    addLine(ledger, settlement.payer_user_id, settlement.amount_inr_cents, {
      type: 'settlement paid',
      date: settlement.settlement_date,
      description: settlement.note || `Paid ${settlement.payee_name}`,
      settlementId: settlement.id,
      detail: `Paid ${settlement.payee_name}`
    });
    addLine(ledger, settlement.payee_user_id, -settlement.amount_inr_cents, {
      type: 'settlement received',
      date: settlement.settlement_date,
      description: settlement.note || `Received from ${settlement.payer_name}`,
      settlementId: settlement.id,
      detail: `Received from ${settlement.payer_name}`
    });
  }

  const balances = [...ledger.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
  return { balances, settlements: simplifySettlements(balances) };
}

function addLine(ledger, userId, deltaCents, meta) {
  const entry = ledger.get(userId);
  entry.netCents += deltaCents;
  entry.lines.push({ ...meta, deltaCents, runningCents: entry.netCents });
}

function ensureLedger(ledger, userId, name) {
  if (!ledger.has(userId)) ledger.set(userId, { user: { id: userId, name }, netCents: 0, lines: [] });
}

function simplifySettlements(balances) {
  const debtors = balances
    .filter((entry) => entry.netCents < -1)
    .map((entry) => ({ id: entry.user.id, name: entry.user.name, amount: -entry.netCents }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((entry) => entry.netCents > 1)
    .map((entry) => ({ id: entry.user.id, name: entry.user.name, amount: entry.netCents }))
    .sort((a, b) => b.amount - a.amount);

  const result = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    result.push({ from: debtors[i], to: creditors[j], amountCents: amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount <= 1) i += 1;
    if (creditors[j].amount <= 1) j += 1;
  }
  return result;
}

module.exports = { calculateBalances };
