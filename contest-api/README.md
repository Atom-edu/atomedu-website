# Art contest API

Cloudflare Worker with a private D1 submission table and private R2 image bucket. The Worker serves routes under `/api/art-contest`. It does not publish entrant images; only a selected winner's image has a public route. The winner and archive appear immediately after judge confirmation.

## Setup and deployment

1. Run `npm ci` in this directory, then copy `wrangler.example.jsonc` to `wrangler.jsonc`. The copied file is ignored by Git. Set `ALLOWED_ORIGIN` to the exact website origin (scheme and host, no trailing slash).
2. Create a D1 database named `atom-contest` with `npx wrangler d1 create atom-contest` and a private R2 bucket named `atom-contest-private` with `npx wrangler r2 bucket create atom-contest-private`. If using different names, update the copied config. Put the D1 `database_id` returned by Wrangler into the copied config only. Never enable public R2 bucket access or an R2 custom domain.
3. Run `npx wrangler d1 migrations apply atom-contest --remote --config wrangler.jsonc` from this directory before sending traffic. For local testing, use `--local` instead. The migration creates all required tables and the one-winner-per-date constraint.
4. Set `JUDGING_PASSWORD` and a separate random `SESSION_SECRET` of at least 32 characters as Worker secrets, using the interactive prompts: `npx wrangler secret put JUDGING_PASSWORD --config wrangler.jsonc` and `npx wrangler secret put SESSION_SECRET --config wrangler.jsonc`. Do not put either value in config or source. For local development, use an ignored `.dev.vars` file.
5. Run `npm run dry-run`, then `npm run deploy` when ready. Set the site's [contest-config.js](../contest-config.js) to the deployed Worker's full URL ending in `/api/art-contest`, then push the static site. Since the site is hosted on GitHub Pages, its own `/api` path cannot run this Worker. A separate `workers.dev` origin works with the exact-origin CORS setting above. Keep the Worker off public traffic until migration and secrets are in place. This repository does not include a route or account ID.
6. Test a submission, judge login, private image retrieval, and winner confirmation on a staging Worker and separate D1/R2 resources before production use. Restrict access to the judging UI and apply Cloudflare WAF/rate-limit rules to the login and submission routes as an additional abuse control.

This package pins Wrangler 4.162.0. Run `npm ci` after a fresh checkout. `wrangler.jsonc`, `.dev.vars`, local Wrangler state, and `node_modules` are excluded from Git.

## Schedule

All time windows use `America/Chicago`, including daylight-saving changes. Submissions for a date open at **21:30 CT the previous day** and close at **19:00 CT**. `phase` is `open` until 19:00, `judging` from 19:00 to 20:30, and `results_pending` from 20:30 to 21:30. Authenticated winner confirmation is permitted from 19:00 until 21:30 to allow a delayed decision. At 21:30 the next contest opens. No winner is selected automatically. If no judge confirms a winner, the latest prior winner remains visible and the current date has no archive entry.

## API contract

All JSON errors have `{ "error": { "code": "...", "message": "..." } }`. Dates are `YYYY-MM-DD`; timestamps are UTC ISO strings. The `Origin` header, if present, must match `ALLOWED_ORIGIN` for writes. Successful responses include `Access-Control-Allow-Origin` only for that exact origin. Do not use wildcard CORS.

| Method and path under `/api/art-contest` | Request | Response |
| --- | --- | --- |
| `GET /state` | None | `{ phase, contestDate, deadlineUtc, nextOpenUtc, latestWinner, archive }`. `latestWinner` is a winner object or `null`; `archive` is a newest-first array. |
| `POST /submissions` | `multipart/form-data`: exactly one each of `name`, `image`, `termsAccepted="true"`, `displayConsent="true"` | `201 { id, contestDate, submittedAt }`. Both required checkboxes must be checked. |
| `POST /judging/login` | JSON `{ "password": "..." }` | `{ token, expiresAt }`; token expires after 8 hours. |
| `GET /judging/submissions` | `Authorization: Bearer <token>` | `{ submissions: [{ id, date, name, imageUrl, submittedAt }], winnerId, winnerName }` for the current contest date. `winnerId` and `winnerName` are `null` until selection. The selected entry is archived and removed from `submissions`. |
| `GET /judging/images/:id` | Same bearer header | Private image bytes, with the stored MIME type. This route also serves a selected winner to an authenticated judge. |
| `DELETE /judging/submissions/:id` | Same bearer header | `{ deleted: true }`. |
| `POST /judging/winners` | Same bearer header; JSON `{ "id": "<submission UUID>", "date": "YYYY-MM-DD" }` | `201 { winner }` during 19:00–21:30 CT. Only one winner per date; the operation archives the winner and deletes that date's submissions in one D1 transaction. |
| `GET /images/:id` | None | Public image bytes only if that submission ID is in the winners table with display consent. |

A winner object is `{ id, date, name, imageUrl, selectedAt }`. Both image URLs are **absolute URLs built from the request's Worker origin**, including when the API runs on `workers.dev`. The frontend reads `window.ATOM_CONTEST_API_BASE` from [contest-config.js](../contest-config.js); when it is empty, entry and judging actions remain disabled. The public `imageUrl` requires no bearer header; the judging `imageUrl` requires the bearer header and should be fetched as a Blob, then rendered through a temporary object URL. Never put the token into a query string or persist it in `localStorage`.

The upload limit is 8 MiB per image and 9 MiB for the entire multipart request. MIME type and magic bytes must match and must be PNG, JPEG, WebP, or GIF. SVG is rejected. JSON bodies are capped at 4 KiB. D1 limits each client IP to 10 login attempts per 15 minutes and applies only a short submission burst limit of 10 attempts per minute; there is no hourly or daily entry cap. The IP is HMAC-hashed before storage. Rate-limit responses are `429` with `Retry-After`. These limits complement, rather than replace, edge WAF controls.

Terms acceptance, the `2026-11-14` terms version, acceptance timestamp, and display consent are stored in D1 while an entry is active and carried into the winner archive. Bump `TERMS_VERSION` in the Worker when the terms change. The site must clearly state that accepting terms confirms the entrant is at least 13; this API records the assertion but cannot independently verify age. Losing submissions are removed from D1 on winner selection, so their consent records are removed with them.

R2 loser deletion happens after the D1 winner transaction. Failed deletions stay in the `image_cleanup` table for the hourly scheduled retry. The hourly task also removes entries from past contest dates if no winner was selected; it never invents a winner. A failed R2 cleanup does not undo a selected winner; those keys have no public image route. If a new R2 upload cannot be committed to D1 and immediate R2 deletion fails, the Worker tries to queue that key for cleanup too. If D1 is also unavailable, an unreferenced private object may remain; monitor private bucket usage and consider an R2 lifecycle policy for stale `entries/` objects after a suitable retention interval.

## Sources checked

- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [D1 Worker API and transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R2 Worker binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
