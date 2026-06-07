# Web app for the first release of JADE LENS

## Viewing your data

- Browse the data repo through a file tree.
- JSON files render as structured "cards" — dates as dates, links as clickable links, lists as lists — rather than raw JSON.
- Markdown files render formatted, with wikilinks and dates handled.
- Dates and datetimes are shown in their own timezone (naive ones as local), never silently converted.

## Editing

- Per-field manual edits, gated by an edit-mode lock (tap to unlock a view).
- Value editors for booleans, numbers, dates/datetimes, and wikilinks; tick markdown task checkboxes.
- Every edit goes through the same pipeline as the bot's and commits one change at a time.

## Sync

- Local-first against your private GitHub data repo: pulls when the app comes to focus, pushes when you save.
- Cross-device conflicts are set aside in a stash you can review and resolve — never lost.

## Setup and app

- Point the app at your data repo with a GitHub token (PAT), stored on your device.
- Appearance settings: colours, spacing, fonts, decimal separator, time format.
- Installable as a phone app (PWA) on Android.
- Shows the assistant name you chose.
