import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const LINQ_BASE = "https://api.linqapp.com/v1";

async function linqFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.LINQ_API_KEY;
  if (!apiKey) {
    throw new Error("Linq API key not configured on server");
  }

  const res = await fetch(`${LINQ_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linq API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerLinqTools(server: McpServer) {
  server.tool(
    "linq_send_message",
    "Send a message via iMessage, RCS, or SMS using Linq",
    {
      to: z.string().describe("Recipient phone number"),
      body: z.string().describe("Message text to send"),
      channel: z.enum(["imessage", "rcs", "sms"]).optional().default("imessage").describe("Messaging channel to use (default: imessage)"),
    },
    async ({ to, body, channel }) => {
      try {
        const data = await linqFetch("/messages", {
          method: "POST",
          body: JSON.stringify({ to, body, channel }),
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
    "linq_list_conversations",
    "List all conversations in Linq",
    {},
    async () => {
      try {
        const data = await linqFetch("/conversations");
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
    "linq_get_conversation",
    "Get details of a specific conversation by ID in Linq",
    {
      id: z.string().describe("The conversation ID"),
    },
    async ({ id }) => {
      try {
        const data = await linqFetch(`/conversations/${id}`);
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
