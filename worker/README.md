# Report email Worker

The Worker accepts authenticated aggregate reports at `POST /reports`, validates
their schema, rebuilds an offline report ZIP and sends it to one configured recipient.
It uses Cloudflare's existing Email Routing `EmailMessage` API; the newer Email
Sending beta service is not required. No domain DNS or mail-routing changes are
performed by the application.

## Deploy

1. Install the repository dependencies and authenticate through the official CLI:
   `bun install --frozen-lockfile --ignore-scripts` and `bun run --bun wrangler whoami`.
   Use the correct account when more than one is listed.
2. Confirm an existing Email Routing sender domain is enabled. Verify the fixed
   recipient with `wrangler email routing addresses create recipient@example.com`
   and have the recipient click the verification link. Do not enable routing or
   change DNS on a live mail domain without its administrator's approval.
3. Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`. Set `account_id`, the
   sender, recipient, binding destination and a unique rate-limit namespace.
4. Create a **new** D1 database, update its ID in the private config and apply
   `migrations/0001_submissions.sql` with `wrangler d1 migrations apply ... --remote`.
   Do not reuse an unrelated application database.
5. Create a high-entropy upload token and put it in `UPLOAD_TOKEN` using
   `wrangler secret put UPLOAD_TOKEN --config worker/wrangler.jsonc` from the repository
   root. The interactive prompt keeps the key out of process arguments. Give the
   same key to authorized report submitters through a private channel, not Git.
6. Run `bun run worker:check`, then `bun run worker:deploy`. Configure clients with
   the deployed HTTPS `/reports` URL and the upload key as described in the root README.

`worker/wrangler.jsonc`, local development secrets and `.wrangler/` state are ignored.
Worker observability is disabled in the example config, and handlers never log
request bodies, bearer tokens, report contents or provider error bodies.

## Delivery semantics

- Authentication, approximate per-credential rate limiting and an 8 MiB request cap.
- Strict report allowlisting; recipients, raw ZIPs and arbitrary HTML cannot be supplied.
- Server-built ZIP limited to 6 MiB before base64 encoding.
- Fixed sender and recipient from deployment configuration, also restricted by the
  Email Routing binding. Cloudflare must verify the destination before delivery works.
- D1 deduplicates identical normalized reports per participant code. It stores only
  a SHA-256 identifier, `sending`/`sent`/`uncertain` state and timestamps.
- `sent` means the email binding accepted the message, not confirmed inbox delivery.
- Ambiguous failures remain `uncertain` and are **not automatically resent**. An
  administrator must investigate before resetting a receipt or requesting a new send.
- The limiter is approximate per Cloudflare location, not a strict global sending quota.
  Large report compression may require a Workers plan with sufficient CPU limits.

`GET /health` is a public liveness check. It does not prove recipient verification
or inbox delivery. Tests use a mock email binding and synthetic reports; production
delivery needs a verified destination and an explicit live validation.
