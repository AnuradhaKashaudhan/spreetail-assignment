# Shared Expenses App

An Express + SQLite app for the flatmates assignment. It supports login, dated group memberships, expenses, settlements, CSV import, import anomaly reports, balance summaries, and per-person ledger traces.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Seeded login:

- Email: `aisha@flat.test`
- Password: `password123`

The app creates `data/app.db` automatically. Delete that file to reset local data.

## Importing `expenses_export.csv`

1. Log in.
2. Open the `Flatmates` group.
3. Upload the CSV through the import form.
4. Set the default USD to INR exchange rate if the sheet has dollar rows without a rate.
5. Open the generated import report from the group page.

The importer does not require editing the CSV before upload. It accepts common header variants such as `date`, `paid by`, `split type`, `participants`, and `split details`.

## Tests

```bash
npm test
```

## AI Used

Built with OpenAI Codex as the primary development collaborator. See `AI_USAGE.md` for the working notes and corrections.

## Deployment

This repository is ready for a Node host such as Render, Railway, Fly.io, or a VM.

Set:

- `PORT`
- `SESSION_SECRET`
- Optional `DB_PATH`

The current workspace does not include deployment credentials, so the public app URL must be filled in after deploying.
