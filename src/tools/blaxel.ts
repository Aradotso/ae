import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BLAXEL_BASE = "https://api.blaxel.ai/v0";

async function blaxelFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.BLAXEL_API_KEY;
  const workspace = process.env.BLAXEL_WORKSPACE;
  if (!apiKey) {
    throw new Error("Blaxel API key not configured on server");
  }
  if (!workspace) {
    throw new Error("Blaxel workspace not configured on server");
  }

  const res = await fetch(`${BLAXEL_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Blaxel API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerBlaxelTools(server: McpServer) {
  server.tool(
    "blaxel_list_agents",
    "List all agents in the Blaxel workspace",
    {},
    async () => {
      try {
        const workspace = process.env.BLAXEL_WORKSPACE;
        const data = await blaxelFetch(`/workspaces/${workspace}/agents`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "blaxel_deploy_agent",
    "Deploy a new agent in the Blaxel workspace",
    {
      name: z.string().describe("Name of the agent to deploy"),
      description: z.string().describe("Description of the agent"),
    },
    async ({ name, description }) => {
      try {
        const workspace = process.env.BLAXEL_WORKSPACE;
        const data = await blaxelFetch(`/workspaces/${workspace}/agents`, {
          method: "POST",
          body: JSON.stringify({ name, description }),
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "blaxel_list_sandboxes",
    "List all sandboxes in the Blaxel workspace",
    {},
    async () => {
      try {
        const workspace = process.env.BLAXEL_WORKSPACE;
        const data = await blaxelFetch(`/workspaces/${workspace}/sandboxes`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "blaxel_list_functions",
    "List all functions in the Blaxel workspace",
    {},
    async () => {
      try {
        const workspace = process.env.BLAXEL_WORKSPACE;
        const data = await blaxelFetch(`/workspaces/${workspace}/functions`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
