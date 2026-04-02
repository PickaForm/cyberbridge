# AGENTS.md

## Encoding (mandatory)
- All text files in this repo must stay UTF-8.
- Never change encoding of an existing file.
- Keep UTF-8 without BOM for text files.
- Do not rewrite full i18n/text files via shell/script when only a few lines are needed.
- For i18n edits, use targeted patches (`apply_patch`) only.

## Coding Style (mandatory)
- No trailing `;` unless required by syntax.
- Use double quotes for strings, except template literals with variables.
- Use explicit method names.
- Use camelCase for variable names.
- Add a JSDoc header for all methods.
- Private methods must start with `_` and include `@private` and `@ignore` in JSDoc.
- For internal helper methods/functions in modules/controllers, use private naming with `_`.

## Readability & Maintainability (mandatory)
- Prefer readability over compactness.
- For large logic blocks inside a function, add a short comment and keep one blank line before the `//` comment line.
- Apply DRY: factorize reusable blocks.

## Module & Controller Structure (mandatory)
- Each module/controller must start with a global explanatory header and usage examples.
- Public methods first, private methods last.

## Response Formatting (mandatory)
- When referencing repository files in assistant responses, use plain text paths only (no Markdown hyperlinks).
- Prefer relative repo paths (example: `projects/airprocess/server/commands/blog/themes/default.json`).
- You may append line numbers in plain text when useful (example: `projects/airprocess/server/commands/blog.js:2344`).

## Anti-mojibake check (mandatory)
- Never use `Set-Content`, `Out-File`, or global rewrite scripts on user-facing text/i18n files.
- Use targeted patches (`apply_patch`) for text edits.
- After any change in user-facing text files (translations, labels, messages), run:
  - `rg "\x{00C3}|\x{00C2}|\x{FFFD}" <file_path>`
- If a match exists:
  - stop immediately,
  - fix encoding/content,
  - run the check again until zero matches.

## Final check before completion
- Before saying a task is done:
  1. run `rg "\x{00C3}|\x{00C2}|\x{FFFD}"` on all modified text/i18n files,
  2. confirm zero matches,
  3. only then send final response.
