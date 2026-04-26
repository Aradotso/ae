#!/usr/bin/env bun
/**
 * Polling-replay template for the /replay-railway-preview skill.
 *
 * Copy into text.ara.so/backend/scripts/replay-<bug-id>.ts, swap PROMPT
 * to the prompt(s) that exercise your fix, and run from
 * text.ara.so/backend with:
 *
 *   URL_BASE=https://website-agent-preview-bdd4.up.railway.app \
 *     bun run scripts/replay-<bug-id>.ts
 *
 * Single-turn mode is the default. For multi-turn, see the MULTI_TURN
 * block at the bottom of this file.
 *
 * The script POLLS Braintrust until the root webhook.inbound span has a
 * non-null `outcome` rather than fixed-sleeping — typical post-fix turn
 * is 30-60s, but cold preview sandboxes can push turn 1 to ~4 min.
 *
 * Secrets — DO NOT hardcode in committed scripts. Source via:
 *   infisical run --projectId=6d518288-7854-49d2-aa42-8ffd285dafa1 \
 *     --env=prod --path=/text-ara-so --recursive -- bun run scripts/replay-<bug>.ts
 * The fallbacks below match the long-lived dev defaults shipped in
 * preview env vars; rotate if compromised.
 */
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

const URL_BASE =
  process.env.URL_BASE ?? "https://website-agent-preview-bdd4.up.railway.app";
const SECRET = process.env.LINQ_SIGNING_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_WIPE_TOKEN;
if (!SECRET) {
  console.error("LINQ_SIGNING_SECRET missing — source via Infisical");
  process.exit(2);
}
const MAX_WAIT_S = Number(process.env.MAX_WAIT_S ?? 240);

// ── Edit these ──────────────────────────────────────────────────────
const BUG_TAG = "my-bug"; // greppable label in BT chat_id
const PHONE = "+15550100110"; // 555-01XX reserved fiction range; pick free
const PROMPT =
  "<the literal user message that exercises your fix; paste from the original BT trace's input.text>";
// ────────────────────────────────────────────────────────────────────

const RUN = Math.floor(Date.now() / 1000).toString(36);
const CHAT = `r${RUN}-${BUG_TAG}`;

async function postWebhook(text: string, idx = 0): Promise<number> {
  const msgId = `r${RUN}-${BUG_TAG.slice(0, 4)}-${idx}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const payload = {
    event_type: "message.received",
    data: {
      id: msgId,
      direction: "inbound",
      sender_handle: { handle: PHONE, is_me: false },
      chat: { id: CHAT },
      parts: [{ type: "text", value: text }],
    },
  };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET!).update(`${ts}.${body}`).digest("hex");
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/webhook/linq`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Timestamp": ts,
      "X-Webhook-Signature": sig,
      "X-Webhook-Event": "message.received",
      "User-Agent": `replay-${BUG_TAG}/1.0`,
    },
    body,
  });
  console.log(
    `[#${idx}] POST status=${res.status} elapsed_ms=${Date.now() - t0} text=${JSON.stringify(text.slice(0, 60))}`,
  );
  return res.status;
}

async function sleep(s: number) {
  await new Promise((r) => setTimeout(r, s * 1000));
}

interface RootSummary {
  outcome: string | null;
  reply: string;
  llmCalls: number;
  toolCalls: number;
  durationS: number;
  rootSpanId: string;
}

function pollBtForRoot(): RootSummary | null {
  const r = spawnSync(
    "bt",
    [
      "view",
      "logs",
      "--project",
      "Ara",
      "--search",
      CHAT,
      "--window",
      "30m",
      "--limit",
      "5",
      "--json",
      "--preview-length",
      "1500",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  let data: { items?: unknown[] };
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  const items = (data.items ?? []) as Array<{ row: Record<string, unknown> }>;
  const inbounds = items.filter((it) => {
    const sa = (it.row.span_attributes ?? {}) as { name?: string };
    return sa.name === "webhook.inbound";
  });
  if (inbounds.length === 0) return null;
  const row = inbounds[0].row as Record<string, unknown>;
  const out = (row.output ?? {}) as { outcome?: string | null; reply?: string };
  if (!out.outcome) return null; // builder still running
  const m = (row.metrics ?? {}) as Record<string, number>;
  return {
    outcome: out.outcome ?? null,
    reply: out.reply ?? "",
    llmCalls: Number(m.llm_calls ?? 0),
    toolCalls: Number(m.tool_calls ?? 0),
    durationS: Number(m.duration ?? 0),
    rootSpanId: String(row.span_id ?? ""),
  };
}

(async () => {
  console.log(`Run id: ${RUN}`);
  console.log(`Target:  ${URL_BASE}`);
  console.log(`User:    ${PHONE}`);
  console.log(`Chat:    ${CHAT}`);
  console.log(`Prompt:  ${PROMPT}\n`);

  const status = await postWebhook(PROMPT);
  if (status !== 200) {
    console.error("webhook rejected; aborting");
    process.exit(1);
  }

  console.log(`\nPolling BT for completion (max ${MAX_WAIT_S}s)…`);
  const start = Date.now();
  let summary: RootSummary | null = null;
  while ((Date.now() - start) / 1000 < MAX_WAIT_S) {
    await sleep(10);
    summary = pollBtForRoot();
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (summary) {
      console.log(
        `  [+${elapsed}s] outcome=${summary.outcome} rounds=${summary.llmCalls} tools=${summary.toolCalls}`,
      );
      break;
    }
    console.log(`  [+${elapsed}s] still running…`);
  }

  if (!summary) {
    console.error(
      `\nTimed out. Inspect manually:\n  bt view logs --project Ara --search "${CHAT}" --window 30m --limit 10 --json`,
    );
    process.exit(2);
  }

  console.log(`\n=== RESULT ===`);
  console.log(`root_span_id: ${summary.rootSpanId}`);
  console.log(`outcome:      ${summary.outcome}`);
  console.log(`rounds:       ${summary.llmCalls}`);
  console.log(`tool_calls:   ${summary.toolCalls}`);
  console.log(`duration_s:   ${summary.durationS.toFixed(1)}`);
  console.log(`reply:        ${summary.reply.slice(0, 600)}`);
  console.log(
    `\nBT permalink:\n  https://www.braintrust.dev/app/Aradotso/p/Ara/logs?r=${summary.rootSpanId}&s=${summary.rootSpanId}`,
  );

  if (ADMIN_TOKEN) {
    console.log(
      `\nWipe (run after you've reviewed the result):\n  curl -X POST ${URL_BASE}/admin/wipe -H "x-admin-token: $ADMIN_WIPE_TOKEN" -H "Content-Type: application/json" -d '{"phone_number":"${PHONE}"}'`,
    );
  } else {
    console.log(
      `\nWipe (export ADMIN_WIPE_TOKEN via Infisical first):\n  curl -X POST ${URL_BASE}/admin/wipe -H "x-admin-token: $ADMIN_WIPE_TOKEN" -H "Content-Type: application/json" -d '{"phone_number":"${PHONE}"}'`,
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* ── MULTI-TURN VARIANT ─────────────────────────────────────────────
 * If your bug needs prior conversation state, replace the single
 * postWebhook + poll above with:
 *
 *   const PROMPTS = ["Coffee shop landing", "make the hero green"];
 *   for (let i = 0; i < PROMPTS.length; i++) {
 *     await postWebhook(PROMPTS[i], i);
 *     // poll until THIS turn's outcome lands before sending the next.
 *     // Two webhooks to the same chat_id are processed sequentially
 *     // by the per-conversation lock — turn N+1 doesn't start until
 *     // turn N's builder finishes. Don't fixed-sleep; poll.
 *   }
 *
 * Then poll for ALL turn outcomes (you'll get N webhook.inbound roots
 * in BT, ordered by created). Iterate `inbounds` rather than taking
 * inbounds[0]. Cleanup wipe goes at the very end, after the last
 * outcome is non-null.
 * ──────────────────────────────────────────────────────────────────── */
