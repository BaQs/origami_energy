# Origami Energy

Energy cards in the Origami style, built on the Home Assistant energy dashboard. A Lovelace card for Home Assistant in a single file, `origami-energy.js`. No dependencies, no build step.

## Commands

- `npm test` runs the Playwright tests against the mock of the Home Assistant frontend in `test/mock`.
- `npm run check` runs `scripts/check-style.mjs`, which rejects wording and formatting typical of generated text.
- `npm run screenshots` renders the README images from `test/shots.json`. It needs the Origami theme in
  `test/mock/theme.local.css`, which is not part of the repository.

Run the first two before every commit.

## Code

- Plain modern JavaScript. Keep the card dependency-free and in one file.
- Add code only for a real need. No abstractions for a single use, no defensive checks for cases that cannot happen.
- Comments explain Home Assistant internals or decisions that are not obvious from the code. No JSDoc, no comments that restate the code.
- Texts go through the string table, in English and French. Home Assistant's language picks the table.
- Every behavior change gets a test. Tests describe behavior in plain words.

## Text

Applies to the README, comments, commit messages, issues and release notes.

- Plain English in normal, natural sentences. Keep it short and on point. Say what something does, not how good it is.
- No emojis, no exclamation marks, no em dashes, no marketing words.
- Headings in sentence case.
- Do not add sections, badges or files that nobody asked for.
- Keep the README short. Everything beyond installation and the basics goes into `<details>` blocks.
- README screenshots come from the mock with made-up data, in the Origami theme. No screenshots of a real home.
- Examples use generic entity ids, never the ones of a real installation.
- Commit with the repository owner's git identity, without Co-Authored-By or other AI trailers. The note on AI in the README covers that.

## Releases

1. Update the version in `origami-energy.js`, `version` in `package.json` and the version in the README's manual install URL.
2. Commit and push.
3. Create a GitHub release with a new tag `vX.Y.Z` and a few lines on what changed. The release workflow attaches `origami-energy.js`.
