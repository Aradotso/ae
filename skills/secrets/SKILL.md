---
name: secrets
description: Ara's secrets convention — all runtime credentials live in Infisical (project "Ara-passwords"), one folder per active GitHub repo (`/ara-engineer`, `/text-ara-so`). The old megarepo lives at `/legacy-ara-megarepo` tagged `legacy` — reference only. Never ask the user to paste keys; never commit .env; never build a custom vault.
---

# Ara secrets

**One rule: runtime secrets live in Infisical. Railway still runs the services, but the secret values are sourced from Infisical. Humans use 1Password. Don't invent a fourth thing.**

## Where to look

Project **Ara-passwords** in Infisical. One folder per active GitHub repo — simple.

- Project ID: `6d518288-7854-49d2-aa42-8ffd285dafa1`
- Environments: `dev`, `staging`, `prod`. **For active folders, treat `dev` and `prod` as identical** — keep them in lockstep. `staging` unused.

Folder layout (mirrors the active repos):

| Folder | Repo | Contents |
|--------|------|----------|
| `/ara-engineer/` | github.com/Aradotso/ara.engineer | MCP server runtime (RESEND, Braintrust, Axiom, Blaxel, Higgsfield, Linq, aracli creds, RAILWAY_API_TOKEN) + ara.engineer Google OAuth client |
| `/text-ara-so/` | github.com/Aradotso/text.ara.so | website-agent SMS service (Cerebras, Blaxel, Linq, Stripe, Cloudflare Workers, Supabase project `lyjbhxxhkkiqifbiudxo`) + text.ara.so Google OAuth client |
| `/legacy-ara-megarepo/` | DEPRECATED — github.com/Aradotso/Ara (megarepo) | Old ara-api + ara-web stack. Tagged `legacy`. **Do not consume from this folder.** Supabase project `[LEGACY] Ara` (`owxlbqepqhmqsrdixthk`) and Railway project `[LEGACY] Ara Backend` are similarly marked. |

### Per-repo OAuth clients

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **per-repo**, never duplicated across folders. Each public surface has its own Google OAuth client in Google Cloud Console with its own authorized redirect URIs. Rule of thumb: if a value is repo-scoped, it lives in that repo's folder — don't spread copies.

### Tags

Workspace has one tag: **`legacy`** (`#ff6b6b`). Apply via Infisical API (`PATCH /api/v3/secrets/raw/<NAME>` with `tagIds`) — the CLI doesn't expose tag assignment yet. Anything tagged `legacy` is reference-only — never copy values out of it for new code.

## How to fetch

### From inside an agent session (MCP tools)

The Ara MCP exposes `infisical_*` tools. Prefer these over Railway for any secret lookup:

```
infisical_get_secret   env=prod  key=SUPABASE_URL  path=/text-ara-so
infisical_list_secrets env=prod  path=/ara-engineer
infisical_list_folders env=prod
```

### From a developer machine (CLI)

```bash
infisical run --projectId=6d518288-7854-49d2-aa42-8ffd285dafa1 --env=prod --path=/text-ara-so --recursive -- bun run dev
# or just load into env:
infisical secrets --projectId=... --env=prod --path=/text-ara-so --recursive -o dotenv > .env.local
```

### From a Railway service runtime

The service's start command wraps itself with `infisical run` and uses a machine identity token. Railway only needs to hold `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET` as a bootstrap — everything else is fetched from Infisical at container start.

## What NOT to do

- **Don't ask the user to paste a credential.** If the agent can't find it, the wiring is broken — fix the wiring.
- **Don't read `.env` / `.env.local` hoping they exist.** Run `infisical secrets -o dotenv` to generate one if you need it locally.
- **Don't add new secrets to Railway env vars.** Railway is a runtime host, not a vault. Put new secrets in Infisical.
- **Don't generate fake/placeholder values.**
- **Don't build your own vault.** No shared sqlite, no `arasecrets` service, no "just for dev" helper. Infisical + 1Password is it.
- **Don't commit secrets.** If one leaks, rotate in Infisical *first*, then deal with git history.
- **Don't fall back to root `/`** — it's intentionally empty. Pre-reorg secrets all moved to `/legacy-ara-megarepo/`.
- **Don't pull from `/legacy-ara-megarepo/` for new code.** It's reference-only.

## Rotation

1. Edit the secret in Infisical (CLI, dashboard, or `infisical_set_secret` tool). Update both `dev` and `prod` so they stay identical.
2. Redeploy the service (Railway redeploys automatically on push; else `railway redeploy`).
3. The new container boots with `infisical run`, which fetches the fresh value.

## When the value isn't in Infisical

Active folders (`/ara-engineer/`, `/text-ara-so/`) should be the source of truth for their repo. The Infisical root `/` is intentionally empty — everything used to live there pre-reorg, all of it has been moved to `/legacy-ara-megarepo/` and tagged `legacy`. **Don't fall back to root** — it's empty by design.

Railway platform-auto vars (`RAILWAY_*`, `PORT`) stay in Railway by design.

If a value truly isn't anywhere, *then* ask the user. Be specific: `"ANTHROPIC_API_KEY isn't in Ara-passwords at /text-ara-so — can you add it via Infisical?"` rather than `"paste your Anthropic key"`.

## Why not Railway for secrets

- Drift: the same keys used to exist on multiple Railway services (ara-api, text-ara-so, mcp) — rotation required updating each one by hand
- Access: Railway has no folder/per-project scoping; Infisical does
- Tooling: Infisical has first-class CLI + SDK for local dev; Railway's is painful outside the platform

1Password stays for anything tied to a *human* (personal logins, SSH keys, recovery codes). Infisical is for what *services* need to run.
