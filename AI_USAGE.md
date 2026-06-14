# AI Usage

AI tool used: OpenAI Codex.

## Key Prompts

- "Build a shared expenses app satisfying the provided assignment."
- "Inspect the workspace and choose an implementation approach that can be explained live."
- "Implement a CSV importer that detects anomalies, documents policies, and produces an import report."
- "Add documentation for schema, anomaly policies, and engineering decisions."

## Incorrect AI Outputs Caught and Fixed

1. The first importer approach treated missing USD exchange rates as `1`. I rejected that because Priya explicitly called out that dollars cannot be treated as rupees. The final importer requires a rate or uses the visible import-form default and records `MISSING_EXCHANGE_RATE`.

2. The first balance sketch counted settlements in the wrong direction. I checked the meaning of positive and negative balances by hand and changed settlement payer to `+amount` and payee to `-amount`, because the payer has reduced what they owe.

3. The first membership rule would have split all equal expenses across current members. That would make Sam responsible for March bills. I changed equal split fallback to use members active on the expense date.

4. The first duplicate policy was too destructive: it described deleting duplicate rows. I changed it to skip duplicate posting and preserve the row in the import report for review.

## Engineer of Record Notes

I read and own the submitted code. The importer policies are intentionally conservative: when the app cannot know the correct answer, it skips or flags the row instead of silently inventing one.
