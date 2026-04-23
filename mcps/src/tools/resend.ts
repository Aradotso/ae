import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RESEND_BASE = "https://api.resend.com";

async function resendFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Resend API key not configured on server");
  }

  const res = await fetch(`${RESEND_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerResendTools(server: McpServer) {
  server.tool(
    "send_email",
    "Send an email via Resend",
    {
      from: z.string().describe("Sender email address (e.g. 'you@yourdomain.com')"),
      to: z.array(z.string()).describe("Array of recipient email addresses"),
      subject: z.string().describe("Email subject line"),
      html: z.string().describe("Email body as HTML"),
    },
    async ({ from, to, subject, html }) => {
      try {
        const data = await resendFetch("/emails", {
          method: "POST",
          body: JSON.stringify({ from, to, subject, html }),
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
    "list_emails",
    "List all emails sent via Resend",
    {},
    async () => {
      try {
        const data = await resendFetch("/emails");
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
    "get_email",
    "Get details of a specific email by ID via Resend",
    {
      id: z.string().describe("The email ID"),
    },
    async ({ id }) => {
      try {
        const data = await resendFetch(`/emails/${id}`);
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
