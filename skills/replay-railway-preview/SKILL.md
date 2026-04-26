---
name: replay-railway-preview
version: 1.0.0
description: |
  End-to-end validate a `text.ara.so/backend` (website-agent) fix against a
  real Railway preview environment BEFORE merging to main. Pushes the
  current branch, deploys the SHA to the long-lived `preview` Railway env,
  confirms the new `git_sha` is live via `/healthz`, then sends a focused
  signed webhook replay (single-turn or short multi-turn) to a reserved
  555-01XX test phone, and polls Braintrust for the root span's `outcome`
  / rounds / tools / reply. Use whenever you change anything in
  `backend/src/` (tool handlers, system prompt, builder loop, etc.) and
  want production-fidelity proof — not just unit tests — before opening
  the PR. Invoked as `/replay-railway-preview` or `/replay railway preview`.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /replay-railway-preview — production-fidelity validation for website-agent fixes

Unit tests prove the guard / handler / parser does what its inputs say.
They do **not** prove the live model on Cerebras follows your new system
prompt, or that a real signed webhook flows through Hono → builder →
Blaxel sandbox → Braintrust the way you expect. Before merging anything
non-trivial to `text.ara.so/backend/src/`, run this skill: it deploys
your branch's SHA to the long-lived preview Railway env (cloned from
prod, real Supabase / real BT / real Blaxel workspace, `preview-*`
sandbox prefix so it cannot collide with prod sandboxes) and replays a
representative user turn against it.

---

## The setup ledger (already provisioned — DO NOT recreate)

The preview env is permanent infrastructure, not ephemeral per-PR. Reuse it.

```
Railway project   text-ara-so       234f1a04-3e7b-463a-a07e-6232b7102420
Railway service   website-agent     102b93f7-8b90-465f-9b28-98782c298841
Preview env       preview           2d16e49e-af45-4806-b860-23d4b47937d0
Production env    production        88249e7b-f653-4d9d-83c0-407f9cb156a4

Preview URL    https://website-agent-preview-bdd4.up.railway.app
Prod URL       https://website-agent-production-9ace.up.railway.app
```

Preview env is a clone of prod + these overrides (already set, don't touch):

```
SANDBOX_NAME_PREFIX=preview     ← so preview Blaxel sandboxes never collide with prod
WARM_POOL_PREFIX=preview-pool
ARA_ENVIRONMENT=preview
PORT=3000
```

Supabase URL, BT API key, Cerebras key, etc. are the same as prod by
design — preview should fail the same way prod does.

---

## Recipe (about 5 min wall-clock for a single-turn replay)

### 1. Push your branch

```bash
git push -u origin "$(git branch --show-current)"
```

### 2. Deploy the SHA to the preview env

Need the Railway MCP. Load it via ToolSearch first if deferred:

```
ToolSearch query="railway"  max_results=30
```

Then deploy:

```
railway_deploy_from_commit
  serviceId=102b93f7-8b90-465f-9b28-98782c298841
  environmentId=2d16e49e-af45-4806-b860-23d4b47937d0
  commitSha=<your full or short SHA>
```

Railpack builds `backend/` (root_directory is already set on the
service). Typical build is 60–120s.

### 3. Confirm the new SHA is live

`/healthz` is the source of truth. The Railway MCP `get_deployment` /
`list_deployments` endpoints have stale GraphQL fragments and frequently
400 — don't waste time there.

```bash
curl -sS https://website-agent-preview-bdd4.up.railway.app/healthz \
  | jq '{status,git_sha,bt_enabled,db_configured,verify_mode,model}'
```

Loop this until `git_sha` matches your commit (truncated to 7 chars).
**Don't proceed with the replay until this matches** — otherwise you're
testing whatever was deployed before.

### 4. Run the replay

Use `scripts/replay-template.ts` from this skill as a starting point —
copy it into `text.ara.so/backend/scripts/replay-<bug-id>.ts`, swap in
the prompt sequence that exercises your fix.

Two designs, in order of preference:

- **Single-turn replay (fastest, ~30–60s):** one webhook whose prompt
  alone exercises the fix. Use this whenever you can — even bugs that
  manifested mid-conversation in the original incident are usually
  reproducible from a single prompt with enough context inlined.
- **Multi-turn replay (~3–5 min):** only when the bug genuinely needs a
  prior site/state. Webhooks for the same `chat_id` queue
  sequentially behind the per-conversation lock — turn N+1 does not
  start until turn N's builder finishes. Plan wait times accordingly.

Run from the text.ara.so worktree:

```bash
cd ~/github/text.ara.so/backend
URL_BASE=https://website-agent-preview-bdd4.up.railway.app \
  bun run scripts/replay-<bug-id>.ts
```

The template polls Braintrust every 10s for the root `webhook.inbound`
span and exits as soon as `outcome` is non-null. That gives you the
honest turn duration; no guessing.

### 5. Read the result

The script prints a one-screen summary:

```
=== RESULT ===
root_span_id: <uuid>
outcome:      ok | hallucinated_update | max_rounds | error | …
rounds:       <int>     ← llm_calls
tool_calls:   <int>
duration_s:   <float>
reply:        "<first 600 chars of the agent's reply>"

BT permalink:
  https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=<root>&s=<root>
```

Compare to the pre-fix incident's metrics. A real fix should show a
clear delta — usually order-of-magnitude on rounds / tools / duration.
If the reply text doesn't match the user-visible behaviour you wanted,
the fix isn't done — open the BT permalink and walk the tool sequence
to see why.

### 6. Wipe the test user

The script intentionally does NOT wipe automatically — the original
incident-debugging session of this skill clobbered turn 2 by wiping
mid-builder. Wipe by hand AFTER you've seen the result:

```bash
infisical run --projectId=6d518288-7854-49d2-aa42-8ffd285dafa1 \
  --env=prod --path=/text-ara-so --recursive -- \
  bash -c 'curl -sS -X POST $URL_BASE/admin/wipe \
    -H "x-admin-token: $ADMIN_WIPE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"phone_number\":\"+15550100104\"}"'
```

(Or use whatever Infisical wrapper you've got — `secrets` skill covers
the pattern. Never paste `ADMIN_WIPE_TOKEN` or `LINQ_SIGNING_SECRET`
into chat or commit them.)

### 7. Do NOT tear the preview env down

It's shared infrastructure. The whole workflow assumes it's there. If
you genuinely need a clean rebuild, ping Adi first.

---

## Conventions

- **Test phones — 555-01XX (reserved fiction range).** Pick a free one
  in the 100–199 block. `+15550100100..104` are already burned by
  prior replays' BT history; use `+15550100110+` for new bugs. If Linq
  ever does try to deliver an outbound, it can't reach a real device.
- **Chat IDs — `r<run-id>-<bug-tag>` so they're greppable in BT.** The
  template uses `Math.floor(Date.now()/1000).toString(36)` as the run
  id — short and unique enough.
- **Don't run two replays against the same chat_id concurrently.** The
  per-conversation lock will queue the second behind the first; if
  your script wipes mid-flight you'll lose the second turn's BT span.
  Use a fresh `chat_id` per run.
- **Secrets come from Infisical.** `LINQ_SIGNING_SECRET` and
  `ADMIN_WIPE_TOKEN` live in Infisical project `Ara-passwords`, folder
  `/text-ara-so`. The template falls back to env vars; export them
  via `infisical run` rather than hardcoding.

---

## Common pitfalls (learned in production)

| Symptom | Cause | Fix |
|---|---|---|
| `outcome=null`, all metrics 0 in BT | Builder hadn't finished when you queried — fixed-sleep too short | Use polling (template does this); don't fixed-sleep on long turns |
| Turn 2 of multi-turn is empty | Wipe ran before per-chat lock released turn 2 | Don't wipe in the script; wipe by hand after verifying |
| `git_sha` on /healthz is your old commit | Deploy still building, or build failed | Check `railway_get_build_logs deploymentId=<id>` (one of the few Railway MCP calls that works); don't replay until /healthz matches |
| BT preview-length truncates JSON parse | Default `--preview-length` is small; some `output` blobs exceed it | Pass `--preview-length 5000` or higher when fetching root spans |
| `railway_get_deployment` 400s with GraphQL field error | Stale schema fragment in MCP | Use `/healthz` for status; use `railway_get_build_logs` / `railway_get_deploy_logs` for what's running |
| Two preview domains both work | `website-agent-preview.up.railway.app` and `…-bdd4.up.railway.app` are aliases on the same service instance | Either is fine; the `-bdd4` suffix is in the original setup ledger so prefer it for greppability |

---

## Cross-refs

- `/trace` — pull and inspect BT spans by chat_id, phone, turn, etc.
  Use this to read the replay results in detail.
- `/secrets` — Infisical convention for `ADMIN_WIPE_TOKEN` /
  `LINQ_SIGNING_SECRET`.
- `/test` — local-only smoke tests that DON'T need the preview env.
  Run that first; only use this skill for production-fidelity proof.

---

## Quick reference

```bash
# 1. push
git push -u origin "$(git branch --show-current)"

# 2. deploy SHA  (load Railway MCP via ToolSearch first)
#    railway_deploy_from_commit serviceId=102b93f7-… envId=2d16e49e-… commitSha=<sha>

# 3. wait for /healthz to report your sha
curl -sS https://website-agent-preview-bdd4.up.railway.app/healthz | jq -r .git_sha

# 4. run replay (copy scripts/replay-template.ts → text.ara.so/backend/scripts/replay-<bug>.ts)
cd ~/github/text.ara.so/backend
URL_BASE=https://website-agent-preview-bdd4.up.railway.app \
  bun run scripts/replay-<bug>.ts

# 5. read BT permalink from script output, compare to pre-fix trace

# 6. wipe (manually, with secrets sourced via Infisical)
```
