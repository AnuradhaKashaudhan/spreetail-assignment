# Scope, Import Policies, and Schema

## Product Scope

The app focuses on the reviewable accounting workflow requested by the flatmates:

- Login with seeded users.
- Create groups and dated membership records.
- Add expenses with equal, exact, percentage, and weighted share splits.
- Add settlements/payments.
- Import `expenses_export.csv` without manual edits.
- Produce a report showing every detected anomaly and the action taken.
- Show group balances, suggested settlements, and per-person ledger traces.

## Anomaly Log and Policies

The importer records anomalies in `import_anomalies`. These are the deliberate data problems it is designed to detect:

| Code | Meaning | Policy | Action |
| --- | --- | --- | --- |
| `INVALID_DATE` | Missing or unparseable date | Do not guess dates | Skip row |
| `FUTURE_DATE` | Date is after import day | Future expenses may be planned | Import and flag |
| `INVALID_AMOUNT` | Missing or non-numeric amount | Do not guess money | Skip row |
| `ZERO_AMOUNT` | Amount is zero | No balance effect | Skip row |
| `NEGATIVE_AMOUNT` | Negative amount | Treat as refund/credit | Import as negative expense |
| `UNKNOWN_PAYER` | Payer name is not a known user | Do not invent members silently | Skip row |
| `PAYER_NOT_ACTIVE` | Payer was not active on the expense date | Guests can pay during trips | Import and flag |
| `MISSING_EXCHANGE_RATE` | USD row has no rate | Use the import form USD default, never 1:1 silently | Import and flag |
| `UNKNOWN_CURRENCY` | Currency has no configured rate | Do not convert silently | Skip row |
| `SETTLEMENT_LOGGED_AS_EXPENSE` | A reimbursement/payment row appears as an expense | Payments should not be shared as expenses | Convert to settlement |
| `SETTLEMENT_PAYEE_UNKNOWN` | Settlement row has no known payee | Settlement requires both sides | Skip row |
| `INVALID_SPLIT_TYPE` | Split type is not supported | Supported types are equal, exact, percentage, shares | Skip row |
| `EMPTY_PARTICIPANTS` | No participants resolved | Fall back only to active members on the expense date | Skip row if still empty |
| `INACTIVE_MEMBER_INCLUDED` | Explicit participant was not active on the date | Honor explicit spreadsheet entries but make them visible | Import and flag |
| `MISSING_SPLIT_DETAILS` | Non-equal split has no details | Exact/percentage/shares need per-person values | Skip row |
| `SPLIT_TOTAL_MISMATCH` | Exact split does not match total | Preserve spreadsheet values for auditability | Import and flag |
| `PERCENT_TOTAL_MISMATCH` | Percentages do not total 100 | Keep proportions and adjust final rounding | Import and flag |
| `EXACT_DUPLICATE` | Same normalized expense already exists | Do not import twice | Skip and report for approval |
| `CONFLICTING_DUPLICATE` | Same date, description, and payer but different amount | Do not choose a winner | Skip later row and report |

## Membership Assumptions

The seeded `Flatmates` group starts with Aisha, Rohan, Priya, and Meera on `2026-02-01`. Meera leaves on `2026-03-31`. Dev is present for the trip from `2026-04-01` through `2026-04-14`. Sam joins on `2026-04-15`.

If an equal split row omits participants, the importer uses the members active on the expense date. Explicit participants are honored even if membership dates disagree, because changing a spreadsheet entry is a user approval decision.

## Balance Model

Balances are calculated in INR cents:

- Expense payer gets `+amount_inr_cents`.
- Each expense participant gets `-share_cents`.
- Settlement payer gets `+amount_inr_cents`.
- Settlement payee gets `-amount_inr_cents`.

Positive means the person should receive money. Negative means the person owes money.

## Database Schema

Relational database: SQLite.

- `users`: login identities.
- `groups`: expense groups.
- `group_memberships`: dated membership intervals.
- `imports`: one row per CSV import.
- `import_anomalies`: detected data problems and policies/actions.
- `expenses`: normalized expenses, original currency, exchange rate, INR amount.
- `expense_shares`: per-person owed shares for each expense.
- `settlements`: payments between people.

See `src/schema.sql` for exact columns, constraints, and indexes.
