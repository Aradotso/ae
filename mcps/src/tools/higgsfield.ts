import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const HIGGSFIELD_BASE = "https://api.higgsfield.ai";

async function higgsfieldFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) {
    throw new Error("Higgsfield API key not configured on server");
  }

  const res = await fetch(`${HIGGSFIELD_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Higgsfield API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerHiggsFieldTools(server: McpServer) {
  server.tool(
    "generate_video",
    "Generate a new AI video from a text prompt using Higgsfield",
    {
      prompt: z.string().describe("Text description of the video to generate"),
      duration: z.number().optional().default(5).describe("Video duration in seconds (1-30)"),
      aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9").describe("Video aspect ratio"),
      style: z.string().optional().describe("Visual style (e.g. 'cinematic', 'anime', 'photorealistic')"),
    },
    async ({ prompt, duration, aspect_ratio, style }) => {
      try {
        const data = await higgsfieldFetch("/v1/generations", {
          method: "POST",
          body: JSON.stringify({
            prompt,
            duration,
            aspect_ratio,
            style: style ?? "cinematic",
          }),
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: data.status ?? "processing",
              generation_id: data.id,
              estimated_time: data.estimated_time ?? "30-60 seconds",
              poll_url: `${HIGGSFIELD_BASE}/v1/generations/${data.id}`,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "check_video_status",
    "Check the status of a Higgsfield video generation job",
    {
      generation_id: z.string().describe("The generation ID returned from generate_video"),
    },
    async ({ generation_id }) => {
      try {
        const data = await higgsfieldFetch(`/v1/generations/${generation_id}`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: data.status,
              progress: data.progress,
              video_url: data.video_url ?? null,
              thumbnail_url: data.thumbnail_url ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "edit_video",
    "Edit an existing video with AI-powered modifications",
    {
      video_url: z.string().url().describe("URL of the source video to edit"),
      edit_prompt: z.string().describe("Description of the edits to make"),
      output_format: z.enum(["mp4", "webm", "gif"]).optional().default("mp4"),
    },
    async ({ video_url, edit_prompt, output_format }) => {
      try {
        const data = await higgsfieldFetch("/v1/edits", {
          method: "POST",
          body: JSON.stringify({
            source_url: video_url,
            prompt: edit_prompt,
            output_format,
          }),
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: data.status ?? "processing",
              edit_id: data.id,
              estimated_time: data.estimated_time ?? "60-120 seconds",
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
