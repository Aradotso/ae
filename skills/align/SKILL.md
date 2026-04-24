---
name: align
version: 1.0.0
description: |
  Align the website-agent (system prompt + routing) with successful on-Ara website building; analyze Braintrust traces for derailment (wrong phase, local-dev tutoring, missing deploy, paywall/connect confusion), patch `text.ara.so/backend` (primarily `system-prompt.ts`), then verify in a tight loop—`bt` / Braintrust evals / `score-recent-traces` / `bt_e2e`—and report a before vs after fit table. Invoked as `/align`, `/align <trace url>`, `/align users …` (pair with `/trace` to gather traces). Companion to `/trace`.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /align — Align the website builder with traces and close the loop

**Stack:** `text.ara.so/backend` (Bun + Hono + Vercel AI SDK v6 + Cerebras + Blaxel + Braintrust).  
**Primary product behavior** is encoded in `src/system-prompt.ts` (`buildSystemPrompt` / `SYSTEM_PROMPT_TEMPLATE`) and the **phase / gate** logic in `server.ts` + `run-builder.ts` (connect, paywall, soft_gate, build).

**Companion skill:** **`/trace`** — fetch permalinks, list users, pull full span trees. **`/align`** consumes that signal to **change prompts and gates** and **prove** improvement.

---

## What “aligned” means here

1. **Single intent:** Ship and iterate on sites **inside Ara** (Blaxel + `*.ara.so`), not general coding homework, not hand-holding the user’s **local** machine (see the “Single intent” / **no local-dev tutoring** blocks in `system-prompt.ts`).
2. **Correct phase:** User gets **build** when they need a site change; **connect** / **paywall** / **soft_gate** only when product rules require it—not when they are mid-build and derailed.
3. **Tools match the story:** No “it’s live!” without `deploy`; no ghost features (forms backend) the product cannot run.
4. **Measurable:** Use existing Braintrust **online scorers** where possible (`builder_outcome_ok`, `tool_budget_ok`, `preview_content_ok`) plus a short **human “task fit”** row (did the reply match what the user was trying to do?).

---

## When the user invokes `/align`

| Intent | What to do first |
|--------|------------------|
| **`/align` + one Braintrust URL** | `bt view trace --url "<url>" --project Ara --json` (or parse `r=` / `s=` from the link) → full tree for that **one turn**. |
| **`/align` + several traces** | Same for each root; or `bt view logs --search "conversation:<chat_id>"` and take each `webhook.inbound` row the user cares about. |
| **`/align` for “these users”** | Use **`/trace top users`** (or equivalent) to list senders + **latest** trace per user; optionally pull **all** turns for a conversation if the failure is multi-turn. |
| **No URL** | Ask for at least one **trace permalink**, **chat_id**, or **phone** + time window so you can pull data. |

Always use **`--preview-length 20000`** (or full `bt view span`) when reading roots so `input` / `metadata` are not truncated.

---

## Diagnosis — what to look for (derailment patterns)

From the **root** `webhook.inbound` and tags / `builder.run` / `doStream` / tools:

| Signal | Often means |
|--------|-------------|
| `phase:soft_gate` / `phase:paywall` / `phase:connect` while the user clearly asked to **build or change a site** | Product gate fired too early or copy is confusing; check `server.ts` / `run-builder` phase selection and whether the **system prompt** should steer “answer product questions in one short block, then continue build” vs long detour. |
| **Long reply** + **zero or few tools** on a **build** turn | Model is “chatting” or tutoring instead of `write_file` / `deploy`; tighten **Single intent** / tool-forcing language in `system-prompt.ts`. |
| User text about **git**, **curl**, **`~/`**, **GitHub**, **option b**, “**no code from you**” | Class “local tutorial” derailment; prompt already has **pivot** rules—verify they fire, or strengthen / add a short canned pivot. |
| `tool:deploy` missing when user used **production trigger words** (see system prompt) | **Must-call-deploy** block or safety-net / `run-builder` (already partially covered; align prompt + any forced-deploy path). |
| `outcome: ok` but **low `preview_content_ok`** (or hallucination in scorer metadata) | Reply claims do not match tools; adjust prompt or tool visibility. |
| `linq_send_ok: false` | Delivery issue, not always prompt—but note if the user never saw the URL. |
| `second_site_requires_pro` / `create_site` errors | Pro messaging alignment (copy in tool return + prompt). |

Record **1–3 concrete failure hypotheses** per trace before editing code.

---

## Where to change behavior (code map)

- **`text.ara.so/backend/src/system-prompt.ts`** — `SYSTEM_PROMPT_TEMPLATE`, `buildSystemPrompt`, style guides. **Start here** for “what the model is allowed to do.”
- **`text.ara.so/backend/src/server.ts`**, **`run-builder.ts`**, **`agent.ts`** — phases, `driveTurn` history, connect/paywall paths. Use when the bug is “wrong phase” or **system prompt is not the right layer**.
- **`text.ara.so/backend/evals/`** — scorers, eval files (see `/trace` skill: `push-scorers`, `trace-scorers.eval.ts`).
- **Braintrust** project **`Ara`**, org **`Aradotso`** — online scorers, datasets (`regression-v1` from `/trace grow`).

**Do not** expand scope: only touch files needed to fix the misfit (same rule as the repo’s coding standards).

---

## Test loop (fast) — end with before / after

1. **Baseline** — for each trace or scenario id, record:
   - `span_id` or permalink
   - Relevant **scores** if present: `builder_outcome_ok`, `tool_budget_ok`, `preview_content_ok` (from Logs UI or `score-recent-traces` / `bt view span`)
   - One line: **“task fit”** (aligned / partial / misfit) from reading user text vs tools vs reply
2. **Patch** — minimal diff to `system-prompt.ts` (and only elsewhere if needed).
3. **Local / CI verification** (pick what fits; run in `text.ara.so/backend`):
   - `bun run scripts/bt_e2e.ts tools` (or `build` / `connect`) for smoke
   - `bun run scripts/score-recent-traces.ts N` on **saved** export or recent prod IDs (if the script supports passing IDs; else re-score after deploy)
   - `npx braintrust eval` on a small eval that mirrors the **failure class** (add a row to an eval or dataset if you need a stable replay)
4. **After deploy to Railway** (if required for apples-to-apples prod traces): re-run the **same** user scenario or a **synthetic** replay with the same user message text; pull the **new** `webhook.inbound` trace.

---

## Output — **before / after table (required)**

When `/align` finishes a slice of work, present a table sorted by **severity** or **user**, for example:

| # | Source (trace / user) | User intent (1 line) | Misfit | Before: fit / scores | After: fit / scores |
|---|------------------------|----------------------|--------|----------------------|----------------------|
| 1 | `…&r=span…` or phone | … | e.g. tutored on git | fit=partial, `builder_outcome_ok=0.2` | fit=aligned, `builder_outcome_ok=0.95` (post-redeploy) |

- **Fit** is short: `aligned` | `partial` | `misfit`.
- If scores are **not** available locally, use **N/A** and still compare behavior from trace reading.
- If you only have **before** in one run, mark **After** as “pending” until redeploy + replay.

**Do not** claim “fixed” without either (a) a new trace or eval showing improvement, or (b) explicit “pending deploy”.

---

## Git / `ara.engineer`

- This file lives in **`ara.engineer/skills/align/SKILL.md`**.  
- After substantive edits, **commit and push** `ara.engineer` `main` so the skill ships with the rest of the engineering docs.

---

## Cross-links

- **`/trace`** — get traces, per-user latest links, top users, SQL, scorers, `grow` dataset.
- **`/braintrust`** — `bt` CLI reference in `ara.engineer/skills/braintrust/SKILL.md`.

---

## Quick reference

| Step | Action |
|------|--------|
| 1. Ingest | `bt view trace` / `/trace` permalinks; optional `conversation:…` search for multi-turn |
| 2. Diagnose | Map tags, phase, tools, user text to derailment patterns above |
| 3. Edit | `system-prompt.ts` first; then `server` / `run-builder` if phase bug |
| 4. Verify | `bt_e2e`, `score-recent-traces`, `braintrust eval`, redeploy + replay |
| 5. Report | Before/after table with fit + scores |

---

## Example prompts (for Loop / the builder)

- “`/align` this trace: `https://www.braintrust.dev/...` — user wanted a landing page but the model sent git instructions.”
- “`/align` top 3 message-count users from yesterday — any systematic tutor-derail; propose one prompt edit.”
- “After changing `system-prompt.ts`, run `bun run scripts/score-recent-traces.ts 20` and show before/after for the same trace IDs (from export).”
