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
  const server = new McpServer({
    name: "ara-connectors",
    version: "1.0.0",
  });

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
