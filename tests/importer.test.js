const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('importer converts USD, skips duplicates, and protects membership dates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-expenses-'));
  process.env.DB_PATH = path.join(tmp, 'test.db');
  delete require.cache[require.resolve('../src/db')];
  const { openDatabase } = require('../src/db');
  const { importCsv } = require('../src/importer');
  const { calculateBalances } = require('../src/balances');
  const db = openDatabase();
  const groupId = db.prepare('SELECT id FROM groups WHERE name = ?').get('Flatmates').id;
  const aishaId = db.prepare('SELECT id FROM users WHERE name = ?').get('Aisha').id;

  const csv = [
    'date,description,amount,currency,paid_by,split_type,participants,shares',
    '2026-03-10,Electricity,3000,INR,Aisha,equal,,',
    '2026-04-05,Trip dinner,100,USD,Priya,equal,"Aisha;Rohan;Priya;Dev",',
    '2026-04-05,Trip dinner,100,USD,Priya,equal,"Aisha;Rohan;Priya;Dev",',
    '2026-04-20,Snacks,600,INR,Sam,exact,"Aisha;Sam","Aisha:300;Sam:200"',
    '2026-04-21,Settlement to Priya,500,INR,Aisha,settlement,Priya,'
  ].join('\n');

  const report = importCsv(db, {
    groupId,
    uploadedByUserId: aishaId,
    filename: 'fixture.csv',
    csvText: csv,
    defaultUsdRate: 80
  });

  assert.equal(report.summary.imported_expense_count, 3);
  assert.equal(report.summary.imported_settlement_count, 1);
  assert.equal(report.summary.skipped_count, 1);
  assert.ok(report.anomalies.some((item) => item.code === 'MISSING_EXCHANGE_RATE'));
  assert.ok(report.anomalies.some((item) => item.code === 'EXACT_DUPLICATE'));
  assert.ok(report.anomalies.some((item) => item.code === 'SPLIT_TOTAL_MISMATCH'));

  const balances = calculateBalances(db, groupId).balances;
  const sam = balances.find((entry) => entry.user.name === 'Sam');
  assert.ok(!sam.lines.some((line) => line.description === 'Electricity'));
});
