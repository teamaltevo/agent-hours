# Agent Hours

Private AI activity reports for OpenCode, Claude Code, Codex and Claude Chat
exports (Desktop/web), compared with your own TimeSentry hours.

**Delivery notice:** after the privacy/consent screen, completed runs submit
sanitized aggregate reports to the default Altevo reporting Worker for email
delivery. Use `--no-send` to keep a run local. No upload key setup is required.

## Run

Requires **Bun 1.4.2+**. Mixed-use classification also requires OpenCode V2 with
a configured model. TimeSentry uses browser sign-in; tokens remain in memory.
The CLI does not require Python or a separate Node.js installation.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run start
```

Type to search in the model picker, use arrow keys to browse, Enter to select
and Escape to cancel. F1 shows model advice. Use `--no-color` or `NO_COLOR=1`
for the plain interface, where `/name` or `/provider` filters the numbered list.
Search matches model names, IDs and providers, including multiple search words.

After the privacy disclosure, conversation classification, sign-in and enabled
report delivery use a `[Y/n]` prompt: Enter continues; `n` cancels. Work-only timing access still asks
for explicit confirmation with a `[y/N]` prompt.

## Sources and output

The report heading and email use the signed-in person's name from TimeSentry's
`current_employee` response. If no profile name is supplied, the CLI uses the
local part of that same person's `@altevo.ca` email as a display name. Other email
domains are not used for guessing. Only the resulting name is exported—not the
email address, employee ID or full profile—and it is not added to classification
prompts. If neither source provides a name, the report stays unnamed.

Charts use pinned **Chart.js 4.6.1**, embedded with its MIT license directly in
each HTML report. No CDN, date adapter, external fonts or internet connection is
needed to view a downloaded report. Legends toggle series and tooltips show
exact values; missing dates remain gaps rather than becoming zeros.

The period is January 1, 2023 through today in Montréal; today remains partial.
Use `--database PATH` to add an OpenCode archive, or
`--clients opencode,codex` to select clients. See `bun run start --help` for all
options.

When the current folder contains `local/approved-source-discovery.json`, its
settings are reused. Otherwise data is stored in `$XDG_DATA_HOME/agent-hours`
or `~/.local/share/agent-hours`. Override with `--data-dir PATH`.

- `reports/`: aggregate JSON reports and daily CSVs, without conversations,
  session IDs or source paths. New reports include TimeSentry project/customer
  names and project-level daily aggregates. Every completed run also creates
  an offline HTML dashboard and a shareable ZIP containing its sanitized JSON,
  HTML, CSV and interpretation notes.
- `local/`: private settings, enum-only classification caches and session indexes.
  Existing Python caches are preserved but not reused by this implementation.

Inspect private attribution metadata without signing in or rereading history:

```sh
bun run start --inspect
bun run start --inspect --details
```

**Do not share or upload private diagnostic output.** Model providers may receive
conversation excerpts and project references after your consent. Secret removal
is best-effort; the provider's retention policy applies.

## Interpreting results

OpenCode uses recorded assistant response spans, including tools and waiting.
Claude Code and Codex use successive message gaps of at most three minutes.
The metrics remain separate; parallel sessions are summed within each client.

Personal, mixed and unknown sessions are excluded from captured work totals.
Successful TimeSentry reads are treated as complete; no separate confirmation or
scope flag is required. Ratios use returned hours on dates with retained client
history and positive work hours. Missing ratios are not zero. Failed reads and
invalid responses still stop reporting; zero-hour dates have no defined ratio.
These are observed-history proxies, not guaranteed bounds or measures of
productivity, compute runtime, human work or billing. Estimates may overcount or
miss activity, and history-date selection can bias the result.

The **All clients** view defaults to **Summed agent-hours**: native captured
session durations are added, including parallel agents. Five agents running for
one developer hour count as five agent-hours (5×). The all-client ratio divides
captured agent-hours by developer hours on dates with available agent history,
counting each date's work hours once. Zero-work dates keep their captured
agent-hours in the total but have no defined daily ratio. Client methods differ,
so this remains a captured-activity proxy, not CPU runtime or productivity.

The **By client** view keeps source series separate. The optional **Elapsed
message-gap estimate** removes overlap and is a different measurement, not a
replacement for summed agent-hours. Older exports can calculate summed totals
but cannot reconstruct cross-client overlap from per-client totals alone.

For spreadsheet totals, filter `daily.csv` to **`client=all`**. Per-client rows
repeat the day's TimeSentry hours for comparison; adding those denominators
across clients would count the same developer time multiple times.
New JSON exports also include the lightweight `all_clients` summary, separately
from the optional `combined` message-gap elapsed estimate.

### Project/day chargeback estimates

New reports include **Project usage & API-equivalent cost**, filterable by
customer, project and AI client. The ZIP also contains `project-daily.csv`: one
row per Montréal date/project across all AI clients, with captured agent-hours,
project work hours, tokens, priced/unpriced usage counts and estimated USD.
Parallel agents are additive; project work hours are counted once. Project
totals use all returned project work hours, unlike the main matched-history
ratio. Work-only dates without agent observations are not priced as zero usage.
The JSON retains per-client/model cost rows for auditing; session durations are
kept on separate rows so switching models never repeats agent-hours.

Only work-classified sessions enter these estimates. A model-selected project
or exactly one catalogue/alias/directory match can attribute a session; ambiguous
sessions remain **Unattributed**, never split across several customers. Work-only
mode does not use conversation text for attribution. Cached classification
decisions retain labels only, not model-selected projects; local evidence can
still attribute them, otherwise they remain Unattributed. TimeSentry still uses
the same read-only calls: `current_employee`, `list_punches`, `list_projects`.
Only your own punches supply project developer hours. Raw project IDs, Jira
links, directories and conversations are not exported.

**Cost basis:** what the recorded tokens would cost at **standard original-vendor
API rates**, not your subscription spend, the reseller's rate or an amount
automatically approved for billing. The calculator uses a pinned, licensed
[LiteLLM price snapshot](src/vendor/api-pricing.json), the principal source also
used by [Tokscale](https://github.com/junhoyeo/tokscale#pricing). It needs no
pricing network calls or native Tokscale/Python dependency at runtime.

- Exact OpenAI/Anthropic model IDs only (including known dated IDs). No fuzzy
  model substitutions, invented model rates or subscription-zero fallback.
- Codex cached input is a subset of input; reasoning is already in output.
  OpenCode's normalized input excludes cache and reasoning is separate from
  output. Claude's input excludes cache and output includes reasoning.
- Rates are applied **per request**, including published long-context tiers;
  daily token totals must not be repriced as a single giant request.
- Known Claude 5-minute/1-hour cache-write buckets are priced separately.
  Unknown write TTL yields a range. This is a cache-duration range for the
  priced subset, **not** a bound on a complete invoice.
- Other models, missing counts/rates and unknown model identities remain
  unpriced. Missing and undated usage are disclosed; no tokens are estimated
  from conversation text or agent-hours. Recorded native cost remains separate.
- The snapshot is a current price list, **not historical 2023–today tariffs**.
  Retired models missing from the list remain unpriced. Taxes, exchange rates,
  markup, negotiated discounts, batch/fast tiers, regional premiums and separate
  search/tool/storage/image/audio charges are excluded.

For client billing, review attribution and coverage, agree the rate basis with
the client, and reconcile with provider usage exports/invoices where available.
These local histories are not a billing ledger or proof of complete usage.
Older aggregate reports lack model/project provenance; rebuilding their HTML
cannot recover it. A fresh local collection is required (use `--no-send`).

Maintainers can refresh pricing with `bun run vendor:pricing`; review the diff,
run tests and update CLI/Worker together. The snapshot records the upstream
commit, file hash and retrieval date; saved reports record its commit hash.

### Detailed measurements

All clients use the same detailed report structure. Availability is source-specific:

- Daily work hours, captured agent activity, ratios and classification counts.
- Summed activity versus non-overlapping elapsed activity and peak concurrency.
- Tool categories, shell-call families, success/failure/unknown counts, recorded
  durations, missing-duration counts and separately labelled round-trip estimates.
- Median and 95th-percentile recorded tool durations, with numeric frequency
  aggregates so distributions can be reproduced without raw tool events.
- Recorded Claude turn durations and explicit response/content intervals where
  present, alongside the unchanged primary activity proxy.
- Weekly/monthly summaries and days with captured activity but zero work hours.
- Source-reported tokens, cache/reasoning fields and estimated cost where present.
  No pricing or missing durations are invented; unavailable values remain null.

Recorded tool duration and round-trip timestamp estimates are not interchangeable.
Tool time overlaps agent time. Turn-duration and tool-duration totals are assigned
to completion date; duration-only records do not fabricate execution intervals.
Token fields can overlap and have different source-specific meanings. Cost is a
recorded estimate, not an invoice.

Claude Code JSONL can retain native `durationMs`, `durationSeconds`, subagent
`totalDurationMs` and `turn_duration` records. Many shell calls retain invocation
and result timestamps but no exact execution duration. For future comprehensive
execution timing, Claude Code also supports OpenTelemetry tool execution spans;
this tool does not enable telemetry, install hooks or change client settings.

### Claude Desktop / Chat exports

In Claude Desktop or claude.ai, use **Settings → Privacy → Export data**, download
the archive and extract `conversations.json`. Then run:

```sh
bun run start --claude-desktop-export /path/to/conversations.json
```

Alternatively, place that file at `local/imports/claude/conversations.json` inside
the data directory for future runs to discover automatically. The importer reads
only the conversation export, not account files, cookies or browser credentials.
Conversation titles, attachments, thinking text and tool outputs are not forwarded
to the classifier. Ordinary user/assistant text follows the same consent and
classification rules as other clients.

The account export may include Desktop, web and mobile chats; it does **not**
prove Desktop-only provenance or complete Cowork history. The Code tab is Claude
Code and is covered where its transcripts are retained in the selected Claude
Code history roots. Removed, remote-only or unexported history remains unavailable.

Official references: [Claude data export](https://support.claude.com/en/articles/9450526-how-can-i-export-my-claude-data),
[Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage),
[Desktop Code tab](https://code.claude.com/docs/en/desktop).

## Automatic email delivery

The default Cloudflare Worker automatically emails completed reports to its
fixed recipient. The CLI uploads **only allowlisted aggregate JSON** over HTTPS;
the Worker validates it again and rebuilds the attached ZIP itself. No conversations,
commands, tool output, source paths, private IDs, runtime profiling or credentials
are uploaded. No raw archive or caller-selected recipient is accepted.

The client and Worker use the public phrase **`altevo-agent-hours`**, stored in
`src/submission-config.ts` and sent in the `X-Report-Phrase` header. This is **not
authentication**: anyone who reads the repository can submit fabricated reports.
The phrase does not prove TimeSentry sign-in, company membership or report accuracy.

The receiver retains schema validation, a fixed recipient, approximate short-window
rate limiting, deduplication and a D1-enforced cap of **50 email attempts per UTC
day** by default. Someone can still consume that allowance and block legitimate
submissions. Use real authentication if the endpoint needs stronger protection.

To override the receiver or supply a participant code, use ignored
`local/delivery.json`:

```json
{
  "endpoint": "https://your-worker.workers.dev/reports",
  "phrase": "altevo-agent-hours",
  "participant": "assigned-code"
}
```

An assigned participant code is optional and is not taken from account identifiers
or private paths. Old upload-token settings are ignored and credential files are
not read for report submission. TimeSentry and model credentials are never included.

`AGENT_HOURS_SUBMIT_URL`, `AGENT_HOURS_PARTICIPANT`, `--submit-url` and `--participant`
can supply run-level overrides. Use `--no-send` to keep a run local. The privacy
screen shows the configured upload endpoint before the run proceeds.

Automatic delivery uses the same receipt on every attempt. The CLI retries
transient failures and waits for in-flight processing for up to three minutes;
the Worker fences preparation attempts so they cannot create duplicate sends.
Interrupted preparation can recover after its 90-second lease expires. An
uncertain outcome after email sending begins is never blindly sent again.

The report and ZIP remain local if delivery cannot complete; the CLI exits with
code 3 and a specific reason. Manual submission is a recovery option, not a normal
step. After checking delivery status, a saved report can be submitted without
rereading history:

```sh
bun run start --send-report /path/to/completed-report.json
```

Identical submissions are deduplicated by report hash in D1. The database stores
only hashes, delivery state, timestamps and daily quota counters—not reports or
participant identities.
Email acceptance is not a guarantee of inbox delivery. See [Worker setup](worker/README.md)
for recipient verification and deployment.

Rebuild the dashboard and ZIP using only a saved aggregate report:

```sh
bun run start --render-report /path/to/completed-report.json
```

Interactive runs open the dashboard after saving unless `--no-open` is set.

Existing successful exports with old "unconfirmed" metadata automatically get
their ratios rebuilt when rendered or submitted again, without rereading history
or repeating classification:

```sh
bun run start --render-report /path/to/report.json
```

Obsolete local completeness-policy files and old confirmation flags no longer
control ratio availability.

## Development

```sh
bun run typecheck
bun test tests-ts
```

After changing the pinned Chart.js version, regenerate its checked-in offline
runtime with `bun run vendor:charts`. The CLI and Worker import that text asset;
they do not read `node_modules` or fetch a library when generating reports.

The old Python CLI has been removed. The standalone `ratio_chart.py` and
`chart_insights.py` utilities remain for existing aggregate reports; they use
Python's standard library and are not required by the CLI. Their regression tests
can be run with `python3 -m unittest discover -s tests`.

The browser OAuth flow has synthetic integration coverage but still needs a live
TimeSentry validation. The package is not published to npm. Once the GitHub
repository is public, it can be run without registry publication:

```sh
bunx --package github:teamaltevo/agent-hours agent-hours
```

The `github:` download does not reuse GitHub CLI authentication for a private repo
in our tested Bun version. For private use, clone with `gh repo clone` and run the
local install instructions above. See [Security and public deployment](SECURITY.md)
before exposing the repository or using the public report endpoint.
