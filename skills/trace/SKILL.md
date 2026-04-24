---
name: trace
version: 2.5.0
description: |
  Ara agent-trace debugging — inspect Braintrust traces for the website-agent (TS/Bun, Cerebras, Vercel AI SDK v6). Invoked as `/trace recent`, `/trace turn <turn_id>`, `/trace convo <chat_id>`, `/trace user <phone>`, `/trace top users` (aggregate: who messaged most in a time window — one latest-turn link per sender, table below), `/trace tool <name>`, `/trace span <id>`, `/trace <url>`, `/trace test` (run canonical e2e via `website-agent/scripts/bt_e2e.ts`), `/trace score`, `/trace online`, or `/trace grow`. **Use `/align`** to align system prompt and gates to traces and report before/after tables (`skills/align/SKILL.md`). **When the user asks for users’ traces / links:** give **one permalink per user** — the **latest** `webhook.inbound` root only. **When they ask for top / busiest users over a time range:** use the **top users table** format (Msgs, User, single review link) — no per-thread “all turns” column unless they ask.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /trace — Agent trace debugging for Ara (TS stack)

Live backend: `website-agent/` (Bun + Hono + Vercel AI SDK v6 + Cerebras).
Braintrust org: **`Aradotso`** · project: **`Ara`**.

Instrumentation lives in `website-agent/src/bt.ts`. Every HTTP turn goes:

```
webhook.inbound                   (task)   ← root; carries phone, chat_id, conversation_id, turn_id
└── builder.run                   (task)   ← one user turn end-to-end
    ├── deploy.force              (tool)   ← safety-net forced deploy (only if triggered)
    └── streamText                (function) ← wrapAISDK child
        ├── doStream              (llm)    ← one per tool-loop round
        ├── tool.create_site      (tool)   ← our span (input args, output, elapsed_ms, round_index, site_slug)
        ├── create_site           (tool)   ← wrapAISDK auto (thinner)
        ├── doStream              (llm)
        ├── tool.write_file       (tool)
        ├── write_file            (tool)
        └── … etc
```

Every span carries (via `SERVICE_META` + `TurnContext`):
`service=website-agent, runtime=bun, env, git_sha, model, conversation_id, turn_id, user_id, phone_number, site_slug, round_index`.

Tags on the root span include:
- `inbound`, `event:message.received`
- `phase:build` | `phase:connect` | `phase:paywall` | `phase:soft_gate` | `phase:unconfigured`
- `conversation:<chat_id>`
- `round:1`, `round:2`, … (one per LLM step)
- `tool:create_site`, `tool:write_file`, … (one per tool invoked)
- `deploy:forced` (only when the safety net fires)

---

## When the user wants “traces for users” — one link per user (default)

**Agent behavior (required):** If they ask for Braintrust links for specific people (by phone, email, or a list of users), default to **exactly one permalink per person** — the **most recent** `webhook.inbound` for that sender — **not** the first/oldest turn and **not** a list of every turn unless they ask for that.

- **How to pick the span:** From `bt view logs` JSON (use `--preview-length 20000` so `metadata` parses) or from SQL, filter roots where `span_attributes.name = 'webhook.inbound'`, match `metadata.phone_number` or `input.sender` (Linq can use an email), **sort by `created` DESC**, take **row 0**. The root’s `span_id` is the permalink id.
- **Permalink (same id for r and s):**  
  `https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<root_span_id>&s=<root_span_id>`
- **What that link is:** The **fullest single-turn trace in Braintrust** for that person — the whole `builder.run` tree for their **last** message. It is still **one** inbound iMessage, not a merged chat history. For “all turns as rows in the log table” or a thread-wide filter, add **one** second link:  
  `https://www.braintrust.dev/app/Aradotso/p/Ara/logs?search=conversation%3A<chat_id>`  
  (use `metadata.conversation_id` from any of their rows). Only include that if they want to browse every turn, not for the default “one link per user” ask.
- **Do not** default to N permalinks for N turns when one link per user is enough.

---

## `/trace top users` — busiest users in a time window (default table)

**When to use:** The user asks for *top users*, *who messaged the most*, *everyone who showed up after 3am*, *users over \[time\]*, *review all of them*, etc. — **except** when they name one person (then use `/trace user` / single latest link only).

**Agent behavior (required output format):** A **markdown table with exactly three columns**, sorted by **`Msgs` descending** (tie-break: sender string ascending):

| Msgs | User | Latest full trace |
|-----:|------|-------------------|
| … | `+1…` or `name@…` or `(unknown sender)` | `https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<span_id>&s=<span_id>` |

- **`Msgs`** = count of `webhook.inbound` root spans for that sender in the window (one per inbound iMessage).
- **`User`** = `metadata.phone_number` or `input.sender` from the row; if missing after parse, `(unknown sender)`.
- **`Latest full trace`** = **one** permalink: the **most recent** `span_id` among that sender’s rows (`created` max). Same `r` and `s` as that root id.
- **Do not** add a second column for “all turns in thread” or `?search=conversation:…` unless the user explicitly asks for it.

**How to build it (run and aggregate in the agent, not the user):**

1. **Time window:** If the user gives a clock in **California** (e.g. “after 3am today”), convert `America/Los_Angeles` → UTC and filter `created >= cutoff`. If they say “last 24h”, use `bt view logs --window 24h`. Use a **wide enough** `--window` (e.g. `36h`, `48h`) so you do not miss edges; still **filter in code** to the exact cutoff if they gave one.
2. **Fetch:** `bt view logs --project Ara --window <W> --limit 500 --json --preview-length 20000` (save stdout to a file if large). Truncated metadata breaks phone extraction.
3. **Filter:** Keep only rows where `span_attributes.name == "webhook.inbound"`.
4. **Group** by sender key: `metadata.phone_number || input.sender || "(unknown sender)"`.
5. **Count** rows per sender; **sort** by count desc.
6. **Latest span:** per sender, `span_id` from the row with max `created`.

**One-line summary for the user** (optional): total distinct senders and total inbound turns in the window.

---

## `/trace recent` — last N turns

```bash
bt view logs --project Ara --limit 10 --json \
 | python3 -c "import sys,json; d=json.load(sys.stdin)
for i in d.get('items', []):
    r=i['row']; a=r.get('span_attributes',{}); m=r.get('metrics',{}) or {}
    meta=r.get('metadata'); meta=json.loads(meta) if isinstance(meta,str) else (meta or {})
    print(f'{a.get(\"name\"):18s} phone={meta.get(\"phone_number\",\"?\")} convo={meta.get(\"conversation_id\",\"?\")[-12:]} tools={m.get(\"tool_calls\",0)} rounds={int(m.get(\"llm_calls\",0))} cost=\${m.get(\"cost_usd\",0):.4f} dur={m.get(\"duration\",0):.1f}s')"
```

Interactive TUI:

```bash
bt view logs --project Ara
```

---

## `/trace convo <chat_id>` — full conversation (every turn)

Each turn of one iMessage thread shares `metadata.conversation_id = <chat_id>`. Two paths:

**A. Tag-based (fast, UI-friendly):**

```bash
bt view logs --project Ara --search "conversation:<chat_id>" --window 24h --limit 50 --json
```

Tags are indexed — `conversation:<chat_id>` lands on every `webhook.inbound` root.

**B. SQL (precise, includes transcript render):**

```bash
PROJ=<project-id>  # grab from bt status --json
bt sql "SELECT created,
               metadata->>'turn_id' AS turn_id,
               metadata->>'phone_number' AS phone,
               input->>'text' AS user_said,
               (output->>'reply')::text AS agent_said,
               (metrics->>'cost_usd')::float AS cost,
               (metrics->>'tool_calls')::int AS tools
        FROM project_logs('\$PROJ')
        WHERE span_attributes->>'name' = 'webhook.inbound'
          AND metadata->>'conversation_id' = '<chat_id>'
        ORDER BY created ASC"
```

That renders the whole conversation as a transcript with cost + tool count per turn.

---

## `/trace turn <turn_id>` — one user turn (all ~16 spans)

Find the root span id for a turn, then fetch the tree:

```bash
PROJ=<project-id>
ROOT=$(bt sql "SELECT span_id FROM project_logs('\$PROJ')
               WHERE metadata->>'turn_id' = '<turn_id>'
                 AND span_attributes->>'name' = 'webhook.inbound'
               LIMIT 1" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['items'][0]['span_id'])")

bt view trace --trace-id "\$ROOT" --project Ara --limit 100 --preview-length 400 --json
```

---

## `/trace user <phone>` — all turns from one phone

```bash
# Tag search (substring match in tags/metadata):
bt view logs --project Ara --search "<phone>" --window 7d --limit 30 --json

# Precise via SQL:
PROJ=<project-id>
bt sql "SELECT created,
               metadata->>'conversation_id' AS chat,
               metadata->>'turn_id' AS turn,
               input->>'text' AS prompt,
               (metrics->>'cost_usd')::float AS cost
        FROM project_logs('\$PROJ')
        WHERE span_attributes->>'name' = 'webhook.inbound'
          AND metadata->>'phone_number' = '<phone>'
        ORDER BY created DESC LIMIT 50"
```

**To answer “give me a trace link for this user” (default):** use **only the top row** of that `ORDER BY created DESC` result (or the same filter in `bt view logs` JSON, latest first). Build `?r=<span_id>&s=<span_id>`. If they need email-shaped handles, search `input.sender` or the same `--search` string — the metadata key is still `phone_number` in the trace even for `user@…` Linq senders.

---

## `/trace tool <name>` — every invocation of one tool

Tool-use timeframe across all users. Tools are spans named `tool.<name>` with
metadata `{tool, site_slug, round_index, conversation_id, turn_id, user_id}`
and metrics `{elapsed_ms, ok}`.

```bash
PROJ=<project-id>
bt sql "SELECT created,
               metadata->>'site_slug' AS slug,
               (metadata->>'round_index')::int AS round,
               (metrics->>'elapsed_ms')::int AS elapsed_ms,
               (metrics->>'ok')::int AS ok,
               metadata->>'turn_id' AS turn,
               metadata->>'phone_number' AS phone,
               output
        FROM project_logs('\$PROJ')
        WHERE span_attributes->>'name' = 'tool.<name>'
          AND created > now() - interval '24 hours'
        ORDER BY elapsed_ms DESC
        LIMIT 30"
```

**Tool-latency distribution (p50/p95):**

```bash
bt sql "SELECT span_attributes->>'name' AS tool,
               count(*) AS n,
               percentile_cont(0.5)  WITHIN GROUP (ORDER BY (metrics->>'elapsed_ms')::float) AS p50_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (metrics->>'elapsed_ms')::float) AS p95_ms,
               sum(((metrics->>'ok')::int = 0)::int) AS fails
        FROM project_logs('\$PROJ')
        WHERE span_attributes->>'name' LIKE 'tool.%'
          AND created > now() - interval '7 days'
        GROUP BY 1
        ORDER BY n DESC"
```

**Every tool in one turn (timeline):**

```bash
PROJ=<project-id>
bt sql "SELECT span_attributes->>'name' AS step,
               (metrics->>'start')::float AS start_ts,
               (metrics->>'elapsed_ms')::int AS elapsed_ms,
               input,
               output
        FROM project_logs('\$PROJ')
        WHERE metadata->>'turn_id' = '<turn_id>'
          AND span_attributes->>'name' LIKE 'tool.%'
        ORDER BY start_ts ASC"
```

---

## `/trace span <id>` — full payload of one span

```bash
PROJ=<project-id>
bt view span --object-ref project_logs:\$PROJ --id <span-id>
```

---

## `/trace <url>` — open a Braintrust permalink

```bash
bt view trace --url "https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<root>&s=<span>" --json
```

Or `open "<url>"` for the browser.

---

## `/trace test` — end-to-end smoke

Re-runs the signed Linq webhook → full span tree verification. Three kinds:

```bash
cd website-agent
# connect flow (CONNECT <token>)
bun scripts/bt_e2e.ts connect

# conversational (no tools, just reply)
bun scripts/bt_e2e.ts build

# tools flow (creates site, writes files, reads dev logs)
bun scripts/bt_e2e.ts tools
```

Script writes a unique `chat_id` + `msg_id`, sends signed HMAC webhook, waits
for the async builder, then `/admin/wipe`s the test user. Prints the `bt view
logs --search "<chat_id>"` command to confirm the trace.

**What a healthy `tools` run looks like in BT:**
- Root `webhook.inbound` tagged `phase:build`, `conversation:bt-e2e-chat-...`, tools used
- 16-ish child spans: 1 `builder.run` → 1 `streamText` → ~5 `doStream` + ~4 `tool.<name>` + ~4 `<name>` (wrapAISDK auto)
- Root metrics: `tool_calls ≥ 3`, `llm_calls ≥ 2`, `cost_usd > 0`, `duration` ~10–20s

---

## `/trace score` — run scorers on recent prod turns

Three trace-scope scorers live in `text.ara.so/backend/evals/scorers/`. Each
takes a `webhook.inbound` root span and returns `{score: 0..1, reason, metadata}`.

| scorer | type | catches |
|---|---|---|
| `tool_budget_ok`     | code         | **speed-first**: end-to-end duration (55%) + minimal tool use (30%) + rounds/LLM/cost tiebreakers (15%). Soft-exponential decay past budget (2× ≈ 0.37). Budgets: 30s duration, 8 tool calls, 5 rounds. |
| `builder_outcome_ok` | code         | hard gates: `outcome==ok`, zero tool errors, non-trivial reply, URL present |
| `preview_content_ok` | LLM judge    | intent mismatch + **hallucinated actions** — agent claimed something tools never did (G-Eval rubric, Cerebras `zai-glm-4.7`, `reasoning_effort: low`) |

**Local run — no upload, fast feedback loop:**

```bash
cd text.ara.so/backend
bun run scripts/score-recent-traces.ts 30                 # 30 most recent turns
LIMIT=50 WINDOW=24h bun run scripts/score-recent-traces.ts
```

Prints per-scorer histogram, mean/p50/std, and pearson correlation + precision/recall
against a ground-truth `hadError` signal (`outcome != "ok" OR tool_errors > 0`).
Then dumps the bottom-3 examples per scorer with the user text, agent reply, and
the scorer's one-line rationale.

**Ship as a Braintrust experiment (online scoring / regression comparison):**

```bash
cd text.ara.so/backend
npx braintrust eval evals/trace-scorers.eval.ts --push
```

**What "valuable" looks like on healthy prod traffic:**
- `builder_outcome_ok`: pearson ≈ 1.00, 100% precision/recall — tight watchdog for real crashes.
- `tool_budget_ok`: pearson ≈ 0.88, ~50% precision — surfaces "slow and/or tool-thrashing" traces the hard-gate scorer misses. A 176s max-rounds run scores ~0.03; a 31s healthy build with 16 tool calls scores ~0.75.
- `preview_content_ok`: low correlation with ground-truth *by design* — it catches silent hallucinations like `"Deploy it" → agent replies "now live! 🚀" with zero tools invoked`. Empty `tools: []` tags on a trace that claimed a deploy is the canonical catch.

**Cost:** ~300 judge tokens per trace at `reasoning_effort: low`. 30 turns ≈ pennies.

**Gotcha:** `zai-glm-4.7` is a reasoning model. Keep judge `maxOutputTokens ≥ 2000` and `providerOptions.cerebras.reasoning_effort: "low"`, or you'll see empty `text` with `finishReason: "length"` and 100% reasoning tokens.

---

## `/trace online` — continuous scoring of every production trace

**All three scorers now run server-side on every webhook.inbound trace:**
- `tool_budget_ok` — code scorer, speed/tool-count gate (canary)
- `builder_outcome_ok` — code scorer, phase-aware hard gates (build turns = URL required, chat/connect = reply-only)
- `preview_content_ok` — **LLM judge (gpt-5-mini via BT proxy)** classifying `pass` / `minor_issue` / `hallucination`. Catches silent "now live!" with zero deploy tool calls.

The LLM judge reads the root-span's input/output, walks child spans via
`trace.getSpans()` to harvest `span_attributes.type == "tool"` → `tools_used[]`,
then asks gpt-5-mini "does the reply match the tools actually invoked?". No
Cerebras/OpenAI secret needed — BT proxies through their credits.

**Push scorers (first-time, and after any edit):**

```bash
cd text.ara.so/backend
# IMPORTANT: BT requires a real node runtime. `bun` masquerading as
# node@24 is rejected with "HTTP 500: Unsupported runtime".
/opt/homebrew/opt/node@22/bin/node node_modules/.bin/braintrust push \
  evals/push-scorers.ts --if-exists replace
```

All three appear under **Ara → Scorers**.

**Automation rule (already wired as `ara-score-turns`):**
- Filter: `span_attributes.name = "webhook.inbound"`
- Scorers: all three (code + LLM judge)
- Sampling: 100%, idle timeout 30s

`builder_outcome_ok` is **phase-aware** — non-build turns (chat, connect,
soft_gate) use relaxed gates (reply ≥ 5 chars, no tool errors, benign
outcome). No separate rule needed.

**Backfill historical logs** (past 3d, up to 100):
Logs → Automations → **Score existing logs** → pick functions → Apply.

**Read the score on every trace:**
- Logs table shows all three columns with AVG at the top. Click a row → see
  the span's individual score + `reason` metadata.
- **Sort/filter by `preview_content_ok`** to find hallucinations; **sort by
  `builder_outcome_ok`** to find real build failures.

**What the online signal actually tells you (observed on ~100 prod traces):**
- `tool_budget_ok` ≈ 100% avg = **canary baseline**. Stays at 1.00; only
  drops when an individual turn regresses (e.g. a tool-thrash loop).
- `builder_outcome_ok` ≈ 92–95% avg = **ongoing functional signal**. The 5–8%
  failing are real (`outcome: noop` on chat turns that attempted a build,
  tool errors, or a build that shipped no URL in the reply).
- `preview_content_ok` ≈ 50–60% avg = **hallucination detector**. About half
  of turns are flagged `minor_issue` or `hallucination` — many are the
  agent overclaiming ("Done! Your site is live") on chat-phase turns that
  never should have built. **This is the scorer that drives the regression
  dataset** (see `/trace grow`).

**When to tighten / loosen budgets:**
- If `tool_budget_ok` avg stays 1.00 for weeks, tighten (e.g. duration 30→20s).
- If `builder_outcome_ok` avg drops below 0.85 for a day, something shipped
  bad — open the Logs dashboard filtered by `phase:build` + low score.

---

## `/trace grow` — harvest worst traces into the regression dataset

Closes the loop. Takes the past week's lowest-scored production traces and
upserts them to a Braintrust dataset (`regression-v1`) for replay-regression
testing. Runs on a **weekly cron** via
`.github/workflows/grow-regression-dataset.yml` (Mondays 13:00 UTC).

```bash
cd text.ara.so/backend
DAYS=7 TOP=40 bun run scripts/grow-regression-dataset.ts            # real write
DRY_RUN=1 DAYS=7 bun run scripts/grow-regression-dataset.ts         # preview only
```

**Pain score** ranks candidates:
`pain = 2·(1−preview_content_ok) + 1·(1−builder_outcome_ok) + 0.5·(1−tool_budget_ok)`, normalized.

Hallucinations weigh 2× because they're the hardest class to catch without
the LLM judge. Deduped by phase + input-text prefix (first 80 chars,
lowercased) so we don't add "Cmon" five times.

**Output:** each row in `regression-v1` has:
- `input.text` — the user message
- `input.phase` — phase the trace was in
- `expected` — `{outcome: "ok", url_required: true}` for build turns, looser for others
- `metadata.trace_id` — BT span id for jumping back to the original
- `metadata.prior_scores` — what the three scorers said when this turn ran live
- `metadata.reply_preview` — first 200 chars of what the agent originally said
- `tags` — `phase:<build|chat|connect|…>`, `source:grower`

**Next step (on PR):** run scorers against this dataset to see if the PR
fixes anything. Simplest is `bun x braintrust eval evals/trace-scorers.eval.ts`
pointing at the replayed trace_ids; richer is a full agent replay (expensive —
needs Blaxel + Linq mocks).

---

## `/trace health` — is instrumentation live?

```bash
curl -sS https://website-agent-production-9ace.up.railway.app/healthz | jq '{bt_enabled, git_sha, db_configured, verify_mode}'

# Synthetic smoke span — fires bt.smoke into BT:
curl -sS -X POST https://website-agent-production-9ace.up.railway.app/admin/bt-test \
  -H "x-admin-token: \$ADMIN_WIPE_TOKEN" -H "x-note: manual-check"

# Then verify:
bt view logs --project Ara --search "manual-check" --window 5m --limit 1 --json
```

If `bt_enabled=false` on `/healthz`, `BRAINTRUST_API_KEY` is missing on Railway.

---

## Workflow: debugging a reported bug

User says "my deploy for fetch-dogs didn't work":

1. **Find their phone's recent turns:**
   ```bash
   bt view logs --project Ara --search "<phone>" --window 24h --limit 10 --json
   ```
2. **Open the most recent `webhook.inbound` with `tool:deploy` tag** — look at root `metrics.tool_calls`, `metrics.tool_fails`, `metadata.last_primary_url`.
3. **Walk to `tool.deploy` span** — its `output` has `{ok, url, vercel_url, exit_code, mode, stage_timings, logs_tail}`.
4. **If `ok=false`** — read `logs_tail` for the Vercel stderr.
5. **If `tool.deploy` doesn't exist** — check for `deploy.force` (safety net); if it's also missing, the model never tried. Look at the final `doStream`'s output to see why.
6. **Cross-reference Supabase** — `deployments` table row for that `site_id`.

---

## Quick reference

| Command | Purpose |
|---------|---------|
| `bt view logs --project Ara` | Interactive log browser |
| **`/trace top users` (time window)** | Aggregate `webhook.inbound` by sender → sort by count → table: **Msgs \| User \| Latest full trace** (one `?r=&s=` per row, no extra columns) |
| **User-facing “one link per user”** | Latest `webhook.inbound` per sender → `?r=&s=` that root `span_id`; optional `?search=conversation%3A<chat_id>` only if they ask for all turns |
| `bt view logs --project Ara --search <term>` | Substring / tag search |
| `bt view logs --project Ara --window 24h` | Time window |
| `bt view trace --trace-id <root> --project Ara --json` | Full span tree |
| `bt view span --object-ref project_logs:<pid> --id <sid>` | Full untruncated span |
| `bt sql "<query>"` | Ad-hoc SQL across spans |
| `bt status --json` | Confirm active org/project |
| `bun run scripts/score-recent-traces.ts N` | Run 3 scorers on last N `webhook.inbound` roots (local) |
| `npx braintrust eval evals/trace-scorers.eval.ts --push` | Ship scorers as a BT experiment |
| `/opt/homebrew/opt/node@22/bin/node node_modules/.bin/braintrust push evals/push-scorers.ts --if-exists replace` | Push all 3 scorers for online scoring (needs real node, not bun) |
| BT UI → Logs → Automations → `ara-score-turns` | Continuous scoring rule (filter `span_attributes.name = "webhook.inbound"`, 100% sampling, all 3 scorers) |
| `bun run scripts/grow-regression-dataset.ts` | Harvest past-week's worst traces into BT dataset `regression-v1` |
| `.github/workflows/grow-regression-dataset.yml` | Weekly cron (Mon 13:00 UTC) grows `regression-v1` |

See `/align` ( **`ara.engineer/skills/align/SKILL.md`** ) for aligning the website-agent system prompt and gates to traces, then testing and **before/after** tables.  
See `/braintrust` for general `bt` CLI reference.
