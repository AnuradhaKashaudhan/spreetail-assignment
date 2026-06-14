const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('./db');
const { importCsv, getImportReport } = require('./importer');
const { calculateBalances } = require('./balances');
const { parseMoneyToCents, formatInr, toInrCents } = require('./money');

const app = express();
const db = openDatabase();
const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'shared-expenses-uploads')
  : path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(cookieSession({
  name: 'shared-expenses-session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  sameSite: 'lax',
  httpOnly: true
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.session.userId)
    : null;
  next();
});

app.get('/login', (req, res) => {
  res.send(layout('Login', loginView(req.query.error), req));
});

app.post('/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(req.body.email || '');
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.redirect('/login?error=1');
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

app.use(requireLogin);

app.get('/', (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, COUNT(gm.id) AS member_count
    FROM groups g
    LEFT JOIN group_memberships gm ON gm.group_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all();
  res.send(layout('Groups', groupsView(groups), req));
});

app.post('/groups', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) {
    const result = db.prepare('INSERT INTO groups (name, created_by_user_id) VALUES (?, ?)').run(name, req.session.userId);
    db.prepare('INSERT INTO group_memberships (group_id, user_id, joined_on) VALUES (?, ?, ?)').run(result.lastInsertRowid, req.session.userId, todayIso());
  }
  res.redirect('/');
});

app.get('/groups/:id', (req, res) => {
  const model = groupModel(req.params.id);
  res.send(layout(model.group.name, groupView(model), req));
});

app.post('/groups/:id/memberships', (req, res) => {
  const userId = Number(req.body.user_id);
  const joined = req.body.joined_on || todayIso();
  const left = req.body.left_on || null;
  db.prepare(`
    INSERT INTO group_memberships (group_id, user_id, joined_on, left_on)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, userId, joined, left);
  res.redirect(`/groups/${req.params.id}#members`);
});

app.post('/groups/:id/expenses', (req, res) => {
  const amountCents = parseMoneyToCents(req.body.amount);
  const currency = String(req.body.currency || 'INR').toUpperCase();
  const rate = currency === 'INR' ? 1 : Number(req.body.exchange_rate || 83.25);
  const amountInrCents = toInrCents(amountCents, currency, rate);
  const splitType = req.body.split_type || 'equal';
  const expense = db.prepare(`
    INSERT INTO expenses
      (group_id, expense_date, description, paid_by_user_id, amount_cents, currency,
       exchange_rate_to_inr, amount_inr_cents, split_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.body.expense_date, req.body.description, req.body.paid_by_user_id, amountCents, currency, rate, amountInrCents, splitType);
  const shares = manualShares(db, req.params.id, splitType, amountInrCents, req.body);
  const insertShare = db.prepare('INSERT INTO expense_shares (expense_id, user_id, share_cents, basis) VALUES (?, ?, ?, ?)');
  for (const share of shares) insertShare.run(expense.lastInsertRowid, share.userId, share.shareCents, share.basis);
  res.redirect(`/groups/${req.params.id}#expenses`);
});

app.post('/groups/:id/settlements', (req, res) => {
  const amountCents = parseMoneyToCents(req.body.amount);
  const currency = String(req.body.currency || 'INR').toUpperCase();
  const rate = currency === 'INR' ? 1 : Number(req.body.exchange_rate || 83.25);
  db.prepare(`
    INSERT INTO settlements
      (group_id, settlement_date, payer_user_id, payee_user_id, amount_cents, currency, exchange_rate_to_inr, amount_inr_cents, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.body.settlement_date, req.body.payer_user_id, req.body.payee_user_id, amountCents, currency, rate, toInrCents(amountCents, currency, rate), req.body.note || null);
  res.redirect(`/groups/${req.params.id}#balances`);
});

app.post('/groups/:id/imports', upload.single('csv'), (req, res) => {
  if (!req.file) return res.redirect(`/groups/${req.params.id}`);
  const csvText = fs.readFileSync(req.file.path, 'utf8');
  const report = importCsv(db, {
    groupId: Number(req.params.id),
    uploadedByUserId: req.session.userId,
    filename: req.file.originalname,
    csvText,
    defaultUsdRate: Number(req.body.default_usd_rate || 83.25)
  });
  fs.unlinkSync(req.file.path);
  res.redirect(`/groups/${req.params.id}/imports/${report.summary.id}`);
});

app.get('/groups/:groupId/imports/:importId', (req, res) => {
  const model = groupModel(req.params.groupId);
  const report = getImportReport(db, req.params.importId);
  res.send(layout('Import report', importReportView(model.group, report), req));
});

app.get('/groups/:groupId/users/:userId/ledger', (req, res) => {
  const model = groupModel(req.params.groupId);
  const entry = model.balances.balances.find((item) => item.user.id === Number(req.params.userId));
  res.send(layout(`${entry.user.name} ledger`, ledgerView(model.group, entry), req));
});

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function groupModel(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  const users = db.prepare('SELECT id, name FROM users ORDER BY name').all();
  const memberships = db.prepare(`
    SELECT gm.*, u.name
    FROM group_memberships gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_on, u.name
  `).all(groupId);
  const expenses = db.prepare(`
    SELECT e.*, u.name AS payer_name
    FROM expenses e
    JOIN users u ON u.id = e.paid_by_user_id
    WHERE e.group_id = ?
    ORDER BY e.expense_date DESC, e.id DESC
    LIMIT 50
  `).all(groupId);
  const imports = db.prepare('SELECT * FROM imports WHERE group_id = ? ORDER BY created_at DESC').all(groupId);
  return { group, users, memberships, expenses, imports, balances: calculateBalances(db, Number(groupId)) };
}

function manualShares(db, groupId, splitType, amountInrCents, body) {
  const participantIds = []
    .concat(body.participants || [])
    .map(Number)
    .filter(Boolean);
  const ids = participantIds.length
    ? participantIds
    : db.prepare(`
      SELECT user_id FROM group_memberships
      WHERE group_id = ? AND joined_on <= ? AND (left_on IS NULL OR left_on >= ?)
    `).all(groupId, body.expense_date, body.expense_date).map((row) => row.user_id);
  if (splitType === 'equal') return splitEvenly(ids, amountInrCents);

  const values = parseDetailLines(body.share_details);
  if (splitType === 'exact') {
    return values.map((item) => ({ userId: item.userId, shareCents: parseMoneyToCents(item.value), basis: `exact:${item.value}` }));
  }
  if (splitType === 'percentage') {
    const shares = values.map((item) => ({ userId: item.userId, shareCents: Math.round(amountInrCents * Number(item.value) / 100), basis: `percentage:${item.value}` }));
    adjustRounding(shares, amountInrCents);
    return shares;
  }
  const totalUnits = values.reduce((sum, item) => sum + Number(item.value), 0);
  const shares = values.map((item) => ({ userId: item.userId, shareCents: Math.round(amountInrCents * Number(item.value) / totalUnits), basis: `shares:${item.value}` }));
  adjustRounding(shares, amountInrCents);
  return shares;
}

function parseDetailLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [userId, value] = line.split(/[:=]/).map((part) => part.trim());
      return { userId: Number(userId), value };
    })
    .filter((item) => item.userId && item.value);
}

function splitEvenly(ids, amountInrCents) {
  const base = Math.trunc(amountInrCents / ids.length);
  let remainder = amountInrCents - base * ids.length;
  return ids.map((userId) => {
    const adjustment = remainder === 0 ? 0 : Math.sign(remainder);
    remainder -= adjustment;
    return { userId, shareCents: base + adjustment, basis: 'equal' };
  });
}

function adjustRounding(shares, targetTotal) {
  const current = shares.reduce((sum, share) => sum + share.shareCents, 0);
  if (shares.length) shares[0].shareCents += targetTotal - current;
}

function layout(title, body, req) {
  const user = req && req.session && req.session.userId ? resUser(req.session.userId) : null;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Shared Expenses</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Shared Expenses</a>
    ${user ? `<form method="post" action="/logout"><span>${escapeHtml(user.name)}</span><button>Log out</button></form>` : ''}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function resUser(userId) {
  return db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
}

function loginView(error) {
  return `<section class="auth">
    <h1>Flatmate expenses</h1>
    <p>Sign in with any seeded user, for example <code>aisha@flat.test</code> and <code>password123</code>.</p>
    ${error ? '<p class="alert">Invalid email or password.</p>' : ''}
    <form method="post" action="/login" class="panel">
      <label>Email <input name="email" type="email" value="aisha@flat.test" required></label>
      <label>Password <input name="password" type="password" value="password123" required></label>
      <button>Log in</button>
    </form>
  </section>`;
}

function groupsView(groups) {
  return `<section class="section-head">
    <div><h1>Groups</h1><p>Create a household or open the seeded Flatmates group.</p></div>
    <form method="post" action="/groups" class="inline-form">
      <input name="name" placeholder="New group name" required>
      <button>Create</button>
    </form>
  </section>
  <div class="grid">${groups.map((group) => `
    <a class="tile" href="/groups/${group.id}">
      <strong>${escapeHtml(group.name)}</strong>
      <span>${group.member_count} membership records</span>
    </a>`).join('')}</div>`;
}

function groupView(model) {
  return `<section class="section-head">
    <div><h1>${escapeHtml(model.group.name)}</h1><p>Balances, settlements, import review, expenses, and dated memberships.</p></div>
    <form method="post" action="/groups/${model.group.id}/imports" enctype="multipart/form-data" class="inline-form">
      <input name="default_usd_rate" type="number" step="0.01" value="83.25" aria-label="Default USD rate">
      <input name="csv" type="file" accept=".csv" required>
      <button>Import CSV</button>
    </form>
  </section>
  ${balancesView(model)}
  ${membershipsView(model)}
  ${expenseForm(model)}
  ${settlementForm(model)}
  ${expenseList(model)}
  ${importsView(model)}`;
}

function balancesView(model) {
  return `<section id="balances" class="band">
    <h2>Balance summary</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Member</th><th>Net</th><th>Trace</th></tr></thead>
      <tbody>${model.balances.balances.map((entry) => `
        <tr>
          <td>${escapeHtml(entry.user.name)}</td>
          <td class="${entry.netCents >= 0 ? 'positive' : 'negative'}">${formatInr(entry.netCents)}</td>
          <td><a href="/groups/${model.group.id}/users/${entry.user.id}/ledger">View ledger</a></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <h3>Suggested settlements</h3>
    <div class="settlements">${model.balances.settlements.length ? model.balances.settlements.map((item) => `
      <div>${escapeHtml(item.from.name)} pays ${escapeHtml(item.to.name)} <strong>${formatInr(item.amountCents)}</strong></div>
    `).join('') : '<p>Everyone is settled.</p>'}</div>
  </section>`;
}

function membershipsView(model) {
  return `<section id="members" class="band">
    <h2>Membership timeline</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Joined</th><th>Left</th></tr></thead>
      <tbody>${model.memberships.map((m) => `<tr><td>${escapeHtml(m.name)}</td><td>${m.joined_on}</td><td>${m.left_on || 'Current'}</td></tr>`).join('')}</tbody>
    </table></div>
    <form method="post" action="/groups/${model.group.id}/memberships" class="inline-form">
      <select name="user_id">${model.users.map(option).join('')}</select>
      <input name="joined_on" type="date" required>
      <input name="left_on" type="date">
      <button>Add membership</button>
    </form>
  </section>`;
}

function expenseForm(model) {
  return `<section class="band">
    <h2>Add expense</h2>
    <form method="post" action="/groups/${model.group.id}/expenses" class="form-grid">
      <label>Date <input name="expense_date" type="date" required></label>
      <label>Description <input name="description" required></label>
      <label>Paid by <select name="paid_by_user_id">${model.users.map(option).join('')}</select></label>
      <label>Amount <input name="amount" type="number" step="0.01" required></label>
      <label>Currency <select name="currency"><option>INR</option><option>USD</option></select></label>
      <label>FX to INR <input name="exchange_rate" type="number" step="0.01" value="83.25"></label>
      <label>Split type <select name="split_type"><option value="equal">Equal</option><option value="exact">Exact</option><option value="percentage">Percentage</option><option value="shares">Shares</option></select></label>
      <fieldset><legend>Participants</legend>${model.users.map((u) => `<label class="check"><input type="checkbox" name="participants" value="${u.id}"> ${escapeHtml(u.name)}</label>`).join('')}</fieldset>
      <label class="wide">Split details for non-equal splits <textarea name="share_details" placeholder="User id:value, one per line. Example: ${model.users[0]?.id || 1}:50"></textarea></label>
      <button>Add expense</button>
    </form>
  </section>`;
}

function settlementForm(model) {
  return `<section class="band">
    <h2>Record settlement</h2>
    <form method="post" action="/groups/${model.group.id}/settlements" class="inline-form">
      <input name="settlement_date" type="date" required>
      <select name="payer_user_id">${model.users.map(option).join('')}</select>
      <span>paid</span>
      <select name="payee_user_id">${model.users.map(option).join('')}</select>
      <input name="amount" type="number" step="0.01" placeholder="Amount" required>
      <select name="currency"><option>INR</option><option>USD</option></select>
      <input name="exchange_rate" type="number" step="0.01" value="83.25">
      <input name="note" placeholder="Note">
      <button>Record</button>
    </form>
  </section>`;
}

function expenseList(model) {
  return `<section id="expenses" class="band">
    <h2>Recent expenses</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Description</th><th>Payer</th><th>Original</th><th>INR</th><th>Split</th></tr></thead>
      <tbody>${model.expenses.map((e) => `<tr><td>${e.expense_date}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.payer_name)}</td><td>${e.currency} ${(e.amount_cents / 100).toFixed(2)}</td><td>${formatInr(e.amount_inr_cents)}</td><td>${e.split_type}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function importsView(model) {
  return `<section class="band">
    <h2>Import reports</h2>
    <div class="grid">${model.imports.map((item) => `
      <a class="tile" href="/groups/${model.group.id}/imports/${item.id}">
        <strong>${escapeHtml(item.filename)}</strong>
        <span>${item.anomaly_count} anomalies · ${item.imported_expense_count} expenses · ${item.skipped_count} skipped</span>
      </a>`).join('') || '<p>No imports yet.</p>'}</div>
  </section>`;
}

function importReportView(group, report) {
  return `<section class="section-head">
    <div><h1>Import report</h1><p>${escapeHtml(report.summary.filename)} imported into ${escapeHtml(group.name)}.</p></div>
    <a class="button" href="/groups/${group.id}">Back to group</a>
  </section>
  <section class="stats">
    <div><strong>${report.summary.row_count}</strong><span>rows</span></div>
    <div><strong>${report.summary.imported_expense_count}</strong><span>expenses</span></div>
    <div><strong>${report.summary.imported_settlement_count}</strong><span>settlements</span></div>
    <div><strong>${report.summary.skipped_count}</strong><span>skipped</span></div>
    <div><strong>${report.summary.anomaly_count}</strong><span>anomalies</span></div>
  </section>
  <section class="band">
    <h2>Anomalies and actions</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Row</th><th>Severity</th><th>Code</th><th>Message</th><th>Policy</th><th>Action</th></tr></thead>
      <tbody>${report.anomalies.map((a) => `<tr><td>${a.row_number || ''}</td><td>${a.severity}</td><td><code>${a.code}</code></td><td>${escapeHtml(a.message)}</td><td>${escapeHtml(a.policy)}</td><td>${escapeHtml(a.action_taken)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function ledgerView(group, entry) {
  return `<section class="section-head">
    <div><h1>${escapeHtml(entry.user.name)} ledger</h1><p>Net balance: <strong>${formatInr(entry.netCents)}</strong></p></div>
    <a class="button" href="/groups/${group.id}">Back to group</a>
  </section>
  <section class="band">
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Basis</th><th>Delta</th><th>Running</th></tr></thead>
      <tbody>${entry.lines.map((line) => `<tr><td>${line.date}</td><td>${line.type}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.detail)}</td><td>${formatInr(line.deltaCents)}</td><td>${formatInr(line.runningCents)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function option(user) {
  return `<option value="${user.id}">${escapeHtml(user.name)}</option>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Shared Expenses app listening at http://localhost:${port}`);
  });
}

module.exports = app;
