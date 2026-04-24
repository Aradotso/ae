---
name: braintrust
description: |
  Braintrust `bt` CLI for Ara — every agent-facing service emits spans to the `Ara` project
  (org `Aradotso`). Use for inspecting logs/traces/prompts/evals, authenticating, SQL over
  spans, and wrapping new code with tracing. For the Ara-specific span shape and debug
  recipes (`/trace recent`, `/trace turn`, `/trace user`, etc.) see the companion `/trace` skill.
triggers:
  - "braintrust"
  - "bt cli"
  - "bt view"
  - "bt sql"
  - "open this trace"
  - "instrument this with braintrust"
  - "add bt spans"
---

# Braintrust — Ara cheat sheet

Single project, single org:

- **Org:** `Aradotso`
- **Project:** `Ara`  (id `a748a67d-8213-4245-981d-b36290db4e2e`)
- **Env var:** `BRAINTRUST_API_KEY` — sourced from Infisical under `/text-ara-so/prod`, `/ara-so/prod`, and `/ara-engineer/prod` (see `/secrets`).

This skill is the *CLI* layer. For Ara's agent span tree and debug workflows, use `/trace`.

---

## Quickstart — am I authed? is traffic flowing?

```bash
bt status                            # current org + project + auth source
bt projects list                     # should show "Ara"
bt view logs --project Ara --limit 5 # 5 most recent spans
```

If `bt status` shows no profile:

```bash
bt auth login --oauth --profile work   # browser flow (best on laptop)
bt auth login                          # interactive, will pick between oauth/api-key
```

CI / headless: `export BRAINTRUST_API_KEY=sk-...` and `bt` auto-resolves.

---

## Services that emit to `Ara`

| Service | Language | Where instrumentation lives |
|---|---|---|
| `website-agent` (text.ara.so backend) | Bun + Hono + `ai@6` | `website-agent/src/bt.ts` + `wrapAISDK(...)` + per-tool `traceTool()` in `src/tools.ts` |
| `ara-api` (Ara Backend) | Go | OTEL → Braintrust exporter |
| `ara.engineer` server | Bun | (future) |

All emit to the same `Ara` project, so `/trace` queries span every service. Use `metadata.service` to filter: `website-agent`, `ara-api`, etc.

---

## Read traces — `bt view`

```bash
# Interactive TUI (arrow keys, Enter to drill in)
bt view logs --project Ara

# Machine-readable — pipe to jq / python
bt view logs --project Ara --limit 20 --json

# Filter by substring in input/output
bt view logs --project Ara --search "deploy" --window 24h --json

# Fetch one trace by root span id
bt view trace --object-ref project_logs:a748a67d-8213-4245-981d-b36290db4e2e \
              --trace-id <root-span-id>

# Or from a shared URL
bt view trace --url "https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<id>&s=<id>"

# Full untruncated payload of one span
bt view span --object-ref project_logs:a748a67d-8213-4245-981d-b36290db4e2e --id <span-id>

# Time windows
bt view logs --project Ara --window 24h --limit 50 --json
bt view logs --project Ara --since "2026-04-24T01:30:00Z" --limit 50 --json
```

Common flags: `--preview-length <N>` (truncation), `--cursor <C>` (pagination), `--filter <EXPR>`, `--print-queries`.

---

## SQL over spans — `bt sql`

Table function: `project_logs('<project-id>')`. Ara's id: `a748a67d-8213-4245-981d-b36290db4e2e`.

```bash
PID="a748a67d-8213-4245-981d-b36290db4e2e"

# Latest real webhooks (skip test phones)
bt sql --json "SELECT span_id, created,
                      metadata.phone_number AS phone,
                      metadata.site_slug    AS slug,
                      metrics.elapsed_s     AS elapsed_s
               FROM project_logs('$PID')
               WHERE span_attributes.name = 'webhook.inbound'
                 AND metadata.phone_number NOT LIKE '%5550000%'
               ORDER BY created DESC LIMIT 20"

# Tool-call distribution last 7 days
bt sql "SELECT span_attributes.name AS tool, count(*)
        FROM project_logs('$PID')
        WHERE span_attributes.type = 'tool' AND created > now() - interval '7 days'
        GROUP BY 1 ORDER BY 2 DESC"

# Slow turns in last 24h
bt sql "SELECT span_id, metrics.elapsed_s AS dur, metadata.site_slug AS slug
        FROM project_logs('$PID')
        WHERE span_attributes.name = 'builder.run' AND created > now() - interval '24 hours'
        ORDER BY metrics.elapsed_s DESC NULLS LAST LIMIT 10"
```

SQL constraints: no JOINs, no subqueries, no UNION/INTERSECT, no window functions. Use `WHERE` aggressively; `HAVING` only after `GROUP BY`.

Full reference: `https://www.braintrust.dev/docs/reference/sql`.

---

## Open a permalink

```bash
# Fetch via CLI
bt view trace --url "<url>"

# Or just open in browser
open "<url>"
```

Permalink shape: `https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<root-id>&s=<span-id>`.

---

## Instrument new code — canonical pattern

For Ara services, the canonical instrumentation is in `text.ara.so/website-agent/src/bt.ts`. Copy that file into a new service and adapt.

Minimum viable instrumentation for a TS service:

```ts
import * as bt from "braintrust";
import { wrapAISDK } from "braintrust";
import * as ai from "ai";

bt.initLogger({
  projectName: "Ara",
  apiKey: process.env.BRAINTRUST_API_KEY,
  asyncFlush: true,
});

// Wrap the Vercel AI SDK — gives you auto-spans for every streamText/tool call
const { streamText, generateText } = wrapAISDK(ai);

// Wrap any async unit of work
await bt.traced(
  async (span) => {
    span.log({ input: { ... }, metadata: { user_id, phone_number } });
    const out = await doWork();
    span.log({ output: out, metrics: { elapsed_ms } });
    return out;
  },
  { name: "my.operation", type: "task" },
);
```

See `/trace` for the Ara span tree conventions (`webhook.inbound` → `builder.run` → `streamText` → `tool.<name>`, and the `conversation_id` / `turn_id` / `round_index` metadata that threads it all together).

---

## Evals — `bt eval`

```bash
# Run all .eval.ts files in CWD (recursive)
bt eval

# Run a specific file
bt eval tests/deploy.eval.ts

# Smoke run — first 20 examples, flagged as non-final in summary
bt eval --first 20 tests/deploy.eval.ts

# Deterministic sample
bt eval --sample 50 --sample-seed 7 tests/deploy.eval.ts

# Pick runner explicitly when auto-detect fails
bt eval --runner vite-node tests/deploy.eval.ts
```

Pass args to the eval file after `--`:

```bash
bt eval foo.eval.ts -- --description "prod-shaped" --shard=1/4
```

---

## Prompts & functions

```bash
bt prompts list --project Ara
bt prompts pull --project Ara --name <slug>       # fetch latest into local
bt prompts push --project Ara --file <path>      # publish a new version

bt functions list --project Ara
bt tools list --project Ara
bt scorers list --project Ara
```

---

## Auth — `bt auth`

```bash
bt auth login                    # interactive (oauth or api-key)
bt auth login --oauth --profile work
bt auth profiles                 # list saved profiles
bt auth status                   # resolved source for current command
bt auth refresh --profile work   # force-refresh oauth access token
bt auth logout                   # remove a profile
```

Resolution order: `--profile` → `--api-key` / `BRAINTRUST_API_KEY` → `BRAINTRUST_PROFILE` → org match → single-profile auto-select.

macOS stores oauth tokens in Keychain. Linux uses `secret-tool` (libsecret) or falls back to a `0600` file.

---

## Setup: bootstrap an agent repo with Braintrust skill files

```bash
bt setup --local                              # interactive wizard
bt setup skills --local --agent claude --agent codex
bt setup instrument --agent codex             # wraps a repo for tracing
bt setup mcp --local --agent claude           # wire up MCP
bt setup doctor --local                       # diagnose
```

`bt setup` installs a ready-to-edit `.claude/skills/braintrust/SKILL.md` (for Claude) and/or `.cursor/rules/braintrust.mdc` (for Cursor), plus prefetches docs to `.bt/skills/docs/`. Cursor integration is local-only.

Prefetched docs land at:

- local: `.bt/skills/docs/README.md`, `.bt/skills/docs/<section>/_index.md`, `.bt/skills/docs/reference/sql.md`
- global: `~/.config/bt/skills/docs/...`

Refresh stale docs: `bt docs fetch --refresh`.

---

## Common pitfalls

- **Missing `stream_options.include_usage`** when using OpenAI-compatible streaming providers (Cerebras, together, etc.) → Braintrust won't get token counts or cost. The Vercel AI SDK v2 provider spec handles this automatically for our stack, but custom SDKs need it set.
- **Traces not appearing** → check `bt status` for the correct project; check `BRAINTRUST_API_KEY` is loaded; check `asyncFlush` isn't lost when a short-lived process exits before flush (force-flush on shutdown or use `waitUntil`).
- **`span_attributes.name` vs `name`** in SQL → always use `span_attributes.name` (the dotted form). `name` as a top-level column is not valid.
- **Joins / window functions fail** in `bt sql` → not supported. Pre-aggregate in `WHERE` + `GROUP BY` instead.

---

## Quick reference

| Command | Purpose |
|---|---|
| `bt status` | Current org/project/auth |
| `bt projects list` | List projects (should show `Ara`) |
| `bt view logs --project Ara` | Interactive log browser |
| `bt view logs --project Ara --json` | Machine-readable |
| `bt view logs --project Ara --search <term> --window 24h` | Time-windowed search |
| `bt view trace --url <permalink>` | Fetch by shared URL |
| `bt view span --object-ref project_logs:<pid> --id <sid>` | Full untruncated span |
| `bt sql "<query>"` | Ad-hoc SQL across spans |
| `bt eval [path]` | Run eval files |
| `bt prompts list --project Ara` | List prompts |
| `bt auth login --oauth` | Authenticate |
| `bt setup instrument --agent codex` | Bootstrap tracing in a repo |

Full flag reference is always one `--help` away: `bt --help`, `bt view --help`, `bt sql --help`, etc.

---

## Docs

- Index: `https://www.braintrust.dev/docs`
- Instrument: `https://www.braintrust.dev/docs/instrument`
- Observe: `https://www.braintrust.dev/docs/observe`
- Evaluate: `https://www.braintrust.dev/docs/evaluate`
- SQL reference: `https://www.braintrust.dev/docs/reference/sql`

After running `bt setup` once, these are also prefetched locally at `.bt/skills/docs/`.
