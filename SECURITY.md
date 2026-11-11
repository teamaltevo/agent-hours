# Security and public deployment

## Public repository versus private data

The intended public tree contains application code, synthetic tests, lockfiles,
documentation and example deployment settings. It must not contain:

- `local/` settings, classifier caches, private session indexes or imported exports.
- Generated `reports/`, conversations, source databases, commands or tool output.
- `.env` files, authentication stores, private keys or real deployment settings.
- `worker/wrangler.jsonc`, `.dev.vars` or `.wrangler/` state.

The package `files` allowlist separately excludes those paths from distribution.
The OAuth client ID in the source is a public client identifier, not a secret.
The configured Worker URL and submission phrase are deliberately public.
Git author names and email addresses are normal repository metadata and may
also become publicly visible; review them before changing repository visibility.

## The public phrase does not authenticate reports

`altevo-agent-hours` is visible in source. Anyone can send a schema-valid report
with it. It does not prove identity, organization membership, TimeSentry sign-in
or accurate measurements. Treat emailed reports as unverified submissions.

The Worker cannot be used to choose arbitrary recipients or forward arbitrary
attachments. It validates allowlisted aggregate fields and builds attachments
itself. Input sizes, an approximate short-window limiter, deduplication and a
D1-backed daily email budget limit abuse. They do not eliminate denial of service,
Cloudflare resource consumption, false reports or exhaustion of the email budget.
Add identity-based authentication or human verification if those risks are unacceptable.

## Consent and outbound data

The CLI discloses the report receiver before the run proceeds. Classification
and sign-in default to Yes at the requested `[Y/n]` prompt; users can cancel with
`n`. The default report receiver is enabled without key setup. Use `--no-send`
to generate local reports without submission.

Only completed, validated aggregate reports are uploaded. Source conversations,
command text, tool output, private session IDs, paths and credentials are excluded.
Aggregated work hours, dates and activity measurements can still be sensitive.
Email recipients and the mail infrastructure necessarily receive that aggregate data.

TimeSentry OAuth tokens remain in memory and are not forwarded to the report
Worker. The earlier report-upload token is obsolete; it must not be published
or confused with the deliberately public phrase.

## Scope of review

Automated tests and targeted tracked-file/history scans are useful checks, not
a formal security audit or a guarantee that no vulnerability or sensitive datum
exists. A public repository also needs a review of its sharing defaults, metadata,
third-party dependencies and organizational approval to disclose its source.
