import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  // ─── Order Lunch prompt (skill-like shortcut) ───
  server.prompt(
    "order_lunch",
    "Order lunch from nearby restaurants — searches, recommends, and can place the order",
    { cuisine: z.string().optional().describe("Type of food (e.g. 'thai', 'burgers', 'salad')") },
    ({ cuisine }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I want to order lunch${cuisine ? ` — specifically ${cuisine} food` : ""}.`,
            "",
            "Please:",
            "1. Use search_restaurants to find highly-rated options near me",
            "2. Show me the top 3-5 options with prices and estimated delivery times",
            "3. Once I pick one, help me build an order",
            "4. Use order_food to place the order (ask me to confirm the total first)",
          ].join("\n"),
        },
      }],
    })
  );

  // ─── Edit Video Clip prompt ───
  server.prompt(
    "edit_video_clip",
    "Edit a video clip with AI using Higgsfield",
    {
      style: z.string().optional().describe("Editing style (e.g. 'cinematic', 'funny', 'dramatic')"),
      video_url: z.string().optional().describe("URL of the video to edit"),
    },
    ({ style, video_url }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I want to edit a video clip${style ? ` in a ${style} style` : ""}.`,
            video_url ? `The video is at: ${video_url}` : "",
            "",
            "Please:",
            "1. Ask me what I want to change if I haven't specified",
            "2. Use edit_video to apply the AI edits",
            "3. Use check_video_status to monitor progress",
            "4. Share the result when it's ready",
          ].join("\n"),
        },
      }],
    })
  );

  // ─── Generate Video prompt ───
  server.prompt(
    "create_video",
    "Generate a new AI video from a description",
    {
      idea: z.string().optional().describe("What the video should show"),
    },
    ({ idea }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I want to create an AI-generated video${idea ? `: ${idea}` : ""}.`,
            "",
            "Please:",
            "1. Help me refine the prompt for best results",
            "2. Ask about duration and aspect ratio preferences",
            "3. Use generate_video to create it",
            "4. Use check_video_status to monitor and share the result",
          ].join("\n"),
        },
      }],
    })
  );
}
