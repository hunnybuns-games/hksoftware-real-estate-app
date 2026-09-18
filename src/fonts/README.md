# Self-hosted fonts

`nunito-latin.woff2` — Nunito, variable weight 200–1000, latin subset. By
Vernon Adams, Cyreal and Jacques Le Bailly; licensed under the SIL Open Font
License 1.1 (https://openfontlicense.org). Downloaded from Google Fonts
(`family=Nunito:wght@400..900`, the `latin` `@font-face` block) on
2026-09-18.

Loaded by `src/app/_components/landing-font.ts` for the cover page only. It's
here rather than linked from Google because the CSP allows `font-src 'self'`
and nothing else, and because a first paint shouldn't wait on a third-party
DNS lookup. To update: fetch the same CSS URL with a modern browser UA, take
the URL from the `latin` block, and replace the file.
