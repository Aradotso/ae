import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import oauthRouter from "./auth/oauth.js";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth.js";
import { registerInstacartTools } from "./tools/instacart.js";
import { registerHiggsFieldTools } from "./tools/higgsfield.js";
import { registerRailwayTools } from "./tools/railway.js";
import { registerBlaxelTools } from "./tools/blaxel.js";
import { registerResendTools } from "./tools/resend.js";
import { registerEngainTools } from "./tools/engain.js";
import { registerLinqTools } from "./tools/linq.js";
import { registerPostizTools } from "./tools/postiz.js";
import { registerPrompts } from "./prompts/index.js";

const PORT = Number(process.env.PORT) || 3000;

// MCP paths — Claude.ai sends requests to "/" while direct connections use "/mcp"
const MCP_PATHS = new Set(["/", "/mcp"]);

// ─── Server instructions shown to every agent on session init ───
// This is the "CLAUDE.md" of the connector. It is sent to the model as the
// system message for any tool-using agent that connects (Claude Desktop,
// Claude Code sandboxes, the Claude API, etc.). Keep it skimmable — agents
// will waste time exploring the filesystem otherwise.
const ARA_INSTRUCTIONS = `# Ara Connectors

You have direct access to Ara's internal tools via MCP. DO NOT grep the filesystem, clone repos, or search the internet for how to call these APIs — the tools below ARE the integration, and all API keys are already configured on the server. Just call them.

## What's available

- **Railway** (40+ tools, prefix \`railway_*\`) — full infra control: projects, services, deployments, variables, domains, volumes, logs, metrics. All keys (including the Railway API token itself) live in Railway env vars — use \`railway_get_variables\` to read them.
- **Instacart** (\`search_products\`, \`search_stores\`, \`create_cart\`, \`check_order_status\`) — grocery search and ordering.
- **Higgsfield** (\`generate_video\`, \`check_video_status\`, \`edit_video\`) — AI video generation.
- **Resend** (\`send_email\`, \`list_emails\`, \`get_email\`) — transactional email. Default \`from\` should be \`hello@ara.so\` unless user specifies otherwise.
- **Blaxel** (\`blaxel_*\`) — agent/sandbox deployment platform.
- **Engain** (\`engain_*\`) — leads / outbound.
- **Linq** (\`linq_*\`) — messaging.
- **Postiz** (\`postiz_*\`) — social media scheduling.

Call \`tools/list\` for exact names and schemas. Arguments match each provider's native API (camelCase IDs, etc.).

## Known Railway IDs (production)

The Ara Connectors MCP server itself runs on Railway. If a user asks about "this connector" or "the ara-connectors service":
- **Project**: \`ara-connectors\` → \`b67dca16-5fea-41b9-ab0e-a7234237adc3\`
- **Environment**: \`production\` → \`f4e22ed4-dde1-4aec-b1b1-375cc715ec38\`
- **Service**: \`ara-connectors\` → \`fcabbab7-ec75-4052-bbcd-b5d1dd974ab8\`

For other projects, call \`railway_list_projects\` first to discover IDs, then drill down with \`railway_get_project\` which returns nested environments + services.

## Secret storage

ALL secrets (API keys, tokens, DB URLs) for Ara services are stored as Railway environment variables. If you need a secret (e.g. to pass to another tool that doesn't have it), fetch it with \`railway_get_variables\` against the right project/env/service. Never prompt the user to paste credentials we likely already have.

## Workflows agents should prefer

**"What env vars does X have?"** → \`railway_list_projects\` → find the project → \`railway_get_variables\` with its IDs.

**"Who am I on Railway?"** → \`railway_whoami\`. (Note: this requires a user-scoped token; account/team tokens will 401 here but still work for everything else.)

**"Redeploy the service"** → \`railway_redeploy\` with \`serviceId\` + \`environmentId\`.

**"Show me logs"** → get the latest deployment via \`railway_list_deployments\`, then \`railway_get_deploy_logs\` with that deployment ID. Use \`railway_get_build_logs\` if the build itself is failing.

**"Set a variable"** → \`railway_set_variable\` (single) or \`railway_set_variables_bulk\` (many). Setting a var automatically triggers a redeploy unless \`skipDeploys\` is true.

## Style

- Be direct. Call tools without asking permission for reads; confirm before destructive writes (deletes, force redeploys on prod, sending emails to real customers).
- If a tool errors with "API key not configured," tell the user which env var is missing — don't invent credentials.
- This connector auto-updates: new tools Sven or Adi push to \`Aradotso/ara-connectors\` on GitHub appear on the next session. If you notice a capability is missing, suggest adding it to the repo.
`;

// ─── Express app ───
const app = express();
// Parse JSON/form bodies for all routes EXCEPT MCP paths (MCP transport reads raw body)
app.use((req, res, next) => {
  if (MCP_PATHS.has(req.path)) return next();
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (MCP_PATHS.has(req.path)) return next();
  express.urlencoded({ extended: true })(req, res, next);
});

// ─── Request logging ───
app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log(`${req.method} ${req.path} ${req.query ? JSON.stringify(req.query) : ""}`);
  }
  next();
});

// ─── OAuth routes (unauthenticated) ───
app.use(oauthRouter);

// ─── Health check ───
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ara-connectors", version: "1.0.0" });
});

// ─── MCP over Streamable HTTP ───
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

function createMcpSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = new McpServer(
    {
      name: "ara-connectors",
      version: "1.0.0",
    },
    {
      instructions: ARA_INSTRUCTIONS,
    },
  );

  registerInstacartTools(server);
  registerHiggsFieldTools(server);
  registerRailwayTools(server);
  registerBlaxelTools(server);
  registerResendTools(server);
  registerEngainTools(server);
  registerLinqTools(server);
  registerPostizTools(server);
  registerPrompts(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  server.connect(transport);
  return { server, transport };
}

// MCP handler — shared between "/" and "/mcp"
async function handleMcp(req: AuthenticatedRequest, res: express.Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  if (req.method === "POST") {
    const { server, transport } = createMcpSession();

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { server, transport });
    }
    return;
  }

  res.status(400).json({ error: "No valid session. Send a POST with an initialize request first." });
}

// Serve MCP on both "/" and "/mcp" — Claude.ai uses "/", direct clients use "/mcp"
app.all("/mcp", requireAuth, handleMcp);
app.all("/", requireAuth, handleMcp);

// ─── Start ───
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ara Connectors MCP server running on port ${PORT}`);
  console.log(`  OAuth discovery: /.well-known/oauth-authorization-server`);
  console.log(`  MCP endpoint:    / and /mcp`);
  console.log(`  Health:          /health`);
});
