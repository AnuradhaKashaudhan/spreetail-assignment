# Decision Log

## Express + Server-Rendered HTML

Options considered: React app with API, Next.js, or plain Express.

I chose Express with server-rendered HTML because the assignment will be reviewed live. Keeping routes, importer, schema, and balance calculations close together makes the code easier to trace and modify in 45 minutes.

## SQLite Relational Database

Options considered: Postgres, MySQL, SQLite.

I chose SQLite because the assignment requires a relational DB and this app needs to run quickly in a local review. The schema is portable to Postgres if the product grows.

## INR Cents as the Accounting Unit

Options considered: store floats, store original currencies only, store integer INR cents.

I chose integer INR cents for all balances to avoid floating point errors. Original currency and exchange rate are still stored on each row for auditability.

## CSV Import Policy

Options considered: reject the whole file on any anomaly, auto-fix everything, import row-by-row with a report.

I chose row-by-row import with an explicit anomaly report. A crashed import and a silent guess both fail the product need; this gives Meera review visibility while preserving useful clean rows.

## Duplicate Handling

Options considered: keep all duplicates, delete exact duplicates, choose the latest conflicting duplicate, require approval.

I chose to skip duplicate posting but record the duplicate in the import report. Conflicting duplicates are never auto-merged because the app has no reliable source of truth for which amount wins.

## Membership Dates

Options considered: split by current members, split by all known people, split by members active on expense date.

I chose date-aware membership. If a row omits participants, only active members on the expense date are included, which protects Sam from March expenses. If the sheet explicitly names an inactive person, the app honors that data and flags it.

## Settlements

Options considered: settlements as negative expenses, separate settlement table.

I chose a separate `settlements` table. Payments between people are not group costs and should not create additional shares.

## Rounding

Options considered: round every share independently, carry fractional cents, or adjust one share.

I chose integer cents and assign the rounding remainder to the largest calculated share. Equal splits distribute remainder one cent at a time. This keeps totals exact and easy to explain.
