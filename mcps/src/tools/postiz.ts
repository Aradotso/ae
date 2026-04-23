import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const POSTIZ_BASE = "https://api.postiz.com/public/v1";

async function postizFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) {
    throw new Error("Postiz API key not configured on server");
  }

  const res = await fetch(`${POSTIZ_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Postiz API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerPostizTools(server: McpServer) {
  server.tool(
    "postiz_schedule_post",
    "Schedule a social media post via Postiz",
    {
      content: z.string().describe("The post content/text"),
      integration_id: z.string().describe("The integration ID of the connected social media account"),
      schedule_date: z.string().describe("ISO 8601 date string for when to publish the post"),
    },
    async ({ content, integration_id, schedule_date }) => {
      try {
        const data = await postizFetch("/posts", {
          method: "POST",
          body: JSON.stringify({
            type: "schedule",
            date: schedule_date,
            posts: [{
              integration: { id: integration_id },
              value: [{ content, image: [] }],
              settings: {},
            }],
          }),
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
    "postiz_list_posts",
    "List all scheduled and published posts in Postiz",
    {},
    async () => {
      try {
        const data = await postizFetch("/posts");
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
    "postiz_list_integrations",
    "List all connected social media accounts in Postiz",
    {},
    async () => {
      try {
        const data = await postizFetch("/integrations");
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
    "postiz_delete_post",
    "Delete a scheduled or published post in Postiz",
    {
      id: z.string().describe("The post ID to delete"),
    },
    async ({ id }) => {
      try {
        const data = await postizFetch(`/posts/${id}`, {
          method: "DELETE",
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
}
