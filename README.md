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

This repository is ready for a Node host such as Render, Railway, Fly.io, Vercel, or a VM.

Set:

- `PORT`
- `SESSION_SECRET`
- Optional `DB_PATH`

### Vercel With Ephemeral SQLite

This app intentionally keeps SQLite. On Vercel, the database and upload temp files are written to `/tmp` because Vercel Functions expose the project filesystem as read-only and only `/tmp` is writable at runtime.

That means data is not durable on Vercel. It may survive while a function instance stays warm, but it can disappear after cold starts, redeploys, or instance replacement. This is acceptable for the assignment/demo mode if you do not need persistence.

Deploy:

```bash
npm i -g vercel
vercel --prod
```

Set `SESSION_SECRET` in Vercel project settings. Do not set `DB_PATH` unless you point it to another writable temporary path.

The current workspace does not include deployment credentials, so the public app URL must be filled in after deploying.
