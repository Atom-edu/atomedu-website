# atomEDU contact API

Cloudflare Worker and D1 storage for the public contact form and the private contact manager.

## Setup

1. Install dependencies with `npm install`.
2. Create the D1 database with `npx wrangler d1 create atom-contact` and copy its ID into `wrangler.jsonc`.
3. Apply migrations with `npx wrangler d1 migrations apply atom-contact --remote --config wrangler.jsonc`.
4. Set `MANAGER_PASSWORD`, `SESSION_SECRET`, and `IP_HASH_SECRET` with `npx wrangler secret put NAME`.
5. Validate with `npm run dry-run`, then deploy with `npm run deploy`.

Public messages are limited to five per source IP per hour. Only an HMAC digest of the IP is retained in the rate limit table. The contact records themselves contain only the title, body, timestamps, and acknowledgement state.
