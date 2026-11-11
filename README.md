# Agent Hours

Private AI activity reports for OpenCode, Claude Code, Codex and Claude Chat
exports (Desktop/web), compared with your own TimeSentry hours.

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

After the privacy disclosure, conversation classification and sign-in use a
`[Y/n]` prompt: Enter continues; `n` cancels. Work-only timing access still asks
for explicit confirmation with a `[y/N]` prompt.

## Sources and output

The period is January 1, 2023 through today in Montréal; today remains partial.
Use `--database PATH` to add an OpenCode archive, or
`--clients opencode,codex` to select clients. See `bun run start --help` for all
options.

When the current folder contains `local/approved-source-discovery.json`, its
settings are reused. Otherwise data is stored in `$XDG_DATA_HOME/agent-hours`
or `~/.local/share/agent-hours`. Override with `--data-dir PATH`.

- `reports/`: aggregate JSON reports and daily CSVs, without conversations,
  session IDs, source paths or project names. Every completed run also creates
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
Ratios require explicitly confirmed complete TimeSentry hours and only use dates
with retained client history and positive work hours. Missing ratios are not zero.
These are observed-history proxies, not guaranteed bounds or measures of
productivity, compute runtime, human work or billing. Estimates may overcount or
miss activity, and history-date selection can bias the result.

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

A configured Cloudflare Worker can automatically email completed reports to its
fixed recipient. The CLI uploads **only allowlisted aggregate JSON** over HTTPS;
the Worker validates it again and rebuilds the attached ZIP itself. No conversations,
commands, tool output, source paths, private IDs, runtime profiling or credentials
are uploaded. No raw archive or caller-selected recipient is accepted.

Configure the data directory's ignored `local/delivery.json` once:

```json
{
  "endpoint": "https://your-worker.workers.dev/reports",
  "token_env": "AGENT_HOURS_UPLOAD_TOKEN",
  "participant": "assigned-code"
}
```

Provide the separate report-upload token through that environment variable. An
owner-only `local/delivery-upload-token` file is also supported by explicitly
adding `"token_file": "delivery-upload-token"` to the configuration. This upload
key is separate from TimeSentry and model credentials; never commit or share it
publicly. An assigned participant code is optional and is not taken from account
identifiers or private paths.

`AGENT_HOURS_SUBMIT_URL`, `AGENT_HOURS_PARTICIPANT`, `--submit-url` and `--participant`
can supply run-level overrides. Use `--no-send` to keep a run local. The privacy
screen shows the configured upload endpoint before the run proceeds.

The report and ZIP remain local if delivery fails; the CLI exits with code 3.
There are no automatic retries after an ambiguous send. After checking delivery
status, an existing completed report can be submitted without rereading history:

```sh
bun run start --send-report /path/to/completed-report.json
```

Identical submissions are deduplicated by report hash in D1. The database stores
only hashes, delivery state and timestamps—not reports or participant identities.
Email acceptance is not a guarantee of inbox delivery. See [Worker setup](worker/README.md)
for recipient verification and deployment.

Rebuild the dashboard and ZIP using only a saved aggregate report:

```sh
bun run start --render-report /path/to/completed-report.json
```

Interactive runs open the dashboard after saving unless `--no-open` is set.

## Development

```sh
bun run typecheck
bun test tests-ts
```

The old Python CLI has been removed. The standalone `ratio_chart.py` and
`chart_insights.py` utilities remain for existing aggregate reports; they use
Python's standard library and are not required by the CLI. Their regression tests
can be run with `python3 -m unittest discover -s tests`.

The browser OAuth flow has synthetic integration coverage but still needs a live
TimeSentry validation. The package is private and unpublished. Its `agent-hours`
executable has been tested through a locally packaged `bunx` invocation; a public
registry command requires choosing a package name and publishing first.
