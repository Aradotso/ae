import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const ENGAIN_BASE = "https://app.engain.io/api/v1";

async function engainFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.ENGAIN_API_KEY;
  if (!apiKey) {
    throw new Error("Engain API key not configured on server");
  }

  const res = await fetch(`${ENGAIN_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Engain API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerEngainTools(server: McpServer) {
  server.tool(
    "engain_list_leads",
    "List all leads in Engain",
    {},
    async () => {
      try {
        const data = await engainFetch("/leads");
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
    "engain_get_lead",
    "Get details of a specific lead by ID in Engain",
    {
      id: z.string().describe("The lead ID"),
    },
    async ({ id }) => {
      try {
        const data = await engainFetch(`/leads/${id}`);
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
    "engain_create_lead",
    "Create a new lead in Engain",
    {
      name: z.string().describe("Full name of the lead"),
      email: z.string().describe("Email address of the lead"),
      phone: z.string().optional().describe("Phone number of the lead"),
      company: z.string().optional().describe("Company name of the lead"),
    },
    async ({ name, email, phone, company }) => {
      try {
        const data = await engainFetch("/leads", {
          method: "POST",
          body: JSON.stringify({ name, email, phone, company }),
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
    "engain_list_campaigns",
    "List all campaigns in Engain",
    {},
    async () => {
      try {
        const data = await engainFetch("/campaigns");
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
