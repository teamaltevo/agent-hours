# Report email Worker

The Worker accepts aggregate reports bearing a public phrase at `POST /reports`, validates
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
   all migrations with `wrangler d1 migrations apply ... --remote`.
   Do not reuse an unrelated application database.
5. The client and Worker share the public phrase in `src/submission-config.ts`.
   No secret needs provisioning. This is a convenience marker, **not access control**.
   Configure `MAX_DAILY_EMAILS` (default 50) to cap email attempts across all locations
   per UTC day. A public submitter can still exhaust that budget.
6. Run `bun run worker:check`, then `bun run worker:deploy`. Configure clients with
   the deployed HTTPS `/reports` URL as described in the root README. Update the
   default endpoint constant if deploying a different receiver.

`worker/wrangler.jsonc`, local development secrets and `.wrangler/` state are ignored.
Worker observability stores only explicit sanitized stage logs. Automatic HTTP
invocation logs are disabled and query strings are redacted. Handlers never log
report bodies, names, participant codes, email addresses, headers, source paths,
credentials or provider error bodies. Stage logs contain a request UUID, opaque
receipt hash, elapsed milliseconds, byte counts, status and fixed error codes.

Historical requests made before this logging was enabled have only the D1 receipt
and preparation state; their exception details cannot be recovered retrospectively.
New CLI failures save a separate `*.delivery-*.json` diagnostic file alongside the
report, including the request UUID needed to correlate the Worker logs. These
diagnostic files are not uploaded automatically.

Project/customer names, per-project daily aggregates and API-equivalent cost are
allowed report fields, but never log fields. The Worker validates their schema
and rebuilds `project-daily.csv` itself, alongside the regular reports. Pricing
data is vendored: Worker rendering never requests third-party rates. Updating the
CLI report schema or pricing allowlist requires deploying the matching Worker.

The same sanitized stages are checkpointed in D1's `delivery_events` table so a
platform interruption does not erase the last completed preparation step. Incoming
report requests prune events older than seven days. Search by a diagnostic request
UUID or opaque receipt, never by employee name (identities are not stored there).

## Delivery semantics

- Public phrase check, approximate short-window rate limiting and an 8 MiB request cap.
- D1 atomically reserves a daily email-attempt slot before each new submission;
  duplicate confirmed submissions do not consume a slot. Failures and racing
  duplicate requests may conservatively consume slots without sending email.
- Strict report allowlisting; recipients, raw ZIPs and arbitrary HTML cannot be supplied.
- Server-built ZIP limited to 6 MiB before base64 encoding.
- ZIP files are encoded/compressed incrementally rather than allocating complete
  UTF-8 buffers for multi-megabyte JSON and HTML files at the same time. The
  validated report object is released before compression begins.
- Fixed sender and recipient from deployment configuration, also restricted by the
  Email Routing binding. Cloudflare must verify the destination before delivery works.
- D1 deduplicates identical normalized reports per participant code. It stores only
  a SHA-256 identifier, delivery state, preparation lease nonces and timestamps.
- A preparation lease expires after 90 seconds; a token-fenced transition to
  `sending` prevents an expired process from sending after a replacement takes over.
  Failed preparation is retryable because no email has started. The client can
  poll processing receipts automatically without creating another email.
- `sent` means the email binding accepted the message, not confirmed inbox delivery.
- Ambiguous email failures remain `uncertain` and are **not automatically resent**. An
  administrator must investigate before resetting a receipt or requesting a new send.
- The short-window limiter is approximate per Cloudflare location. The separate
  D1 daily budget is shared globally. Neither verifies a submitter's identity;
  the public phrase allows fabricated reports and quota-exhaustion attacks.
  Large report compression may require a Workers plan with sufficient CPU limits.

`GET /health` is a public liveness check. It does not prove recipient verification
or inbox delivery. Tests use a mock email binding and synthetic reports; production
delivery needs a verified destination and an explicit live validation.
