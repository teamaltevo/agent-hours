# Agent Hours

Private local AI activity reports for OpenCode, Claude Code and Codex, compared
with your own TimeSentry hours.

## Run

Requires **Bun 1.4.2+**. Mixed-use classification also requires OpenCode V2 with
a configured model. TimeSentry uses browser sign-in; tokens remain in memory.
The CLI does not require Python or a separate Node.js installation.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run start
```

Safe previews, with no history reads, sign-in, model calls or report writes:

```sh
bun run start --demo
bun run start --demo-picker
```

Type to search in the model picker, use arrow keys to browse, Enter to select
and Escape to cancel. F1 shows model advice. Use `--no-color` or `NO_COLOR=1`
for the plain interface.

## Sources and output

The period is January 1, 2023 through today in Montréal; today remains partial.
Use `--database PATH` to add an OpenCode archive, or
`--clients opencode,codex` to select clients. See `bun run start --help` for all
options.

When the current folder contains `local/approved-source-discovery.json`, its
settings are reused. Otherwise data is stored in `$XDG_DATA_HOME/agent-hours`
or `~/.local/share/agent-hours`. Override with `--data-dir PATH`.

- `reports/`: aggregate JSON reports and daily CSVs, without conversations,
  session IDs, source paths or project names.
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
