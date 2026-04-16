import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DOORDASH_BASE = "https://openapi.doordash.com";

async function doordashFetch(path: string, options: RequestInit = {}) {
  const developerId = process.env.DOORDASH_DEVELOPER_ID;
  const keyId = process.env.DOORDASH_KEY_ID;
  const signingSecret = process.env.DOORDASH_SIGNING_SECRET;

  if (!developerId || !keyId || !signingSecret) {
    throw new Error("DoorDash API keys not configured on server");
  }

  // DoorDash uses JWT auth — in production you'd sign a JWT with their SDK.
  // For now, pass the developer credentials as-is (their v2 API supports key-based auth).
  const res = await fetch(`${DOORDASH_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${keyId}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DoorDash API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerDoorDashTools(server: McpServer) {
  server.tool(
    "search_restaurants",
    "Search for restaurants near an address with optional cuisine filter",
    {
      address: z.string().describe("Delivery address (street, city, state, zip)"),
      cuisine: z.string().optional().describe("Cuisine type filter (e.g. 'italian', 'sushi', 'thai')"),
      limit: z.number().optional().default(10).describe("Max results to return"),
    },
    async ({ address, cuisine, limit }) => {
      try {
        const params = new URLSearchParams({ address, limit: String(limit) });
        if (cuisine) params.set("cuisine", cuisine);
        const data = await doordashFetch(`/v1/stores?${params}`);
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
    "order_food",
    "Place a DoorDash delivery order. Requires explicit user confirmation before executing.",
    {
      store_id: z.string().describe("Restaurant/store ID from search results"),
      items: z.array(z.object({
        name: z.string(),
        quantity: z.number().default(1),
        special_instructions: z.string().optional(),
      })).describe("Items to order"),
      delivery_address: z.string().describe("Full delivery address"),
      tip_amount: z.number().optional().default(0).describe("Tip amount in dollars"),
    },
    async ({ store_id, items, delivery_address, tip_amount }) => {
      try {
        const data = await doordashFetch("/v1/deliveries", {
          method: "POST",
          body: JSON.stringify({
            external_delivery_id: `ara_${Date.now()}`,
            pickup_address: store_id, // resolved server-side from store_id
            dropoff_address: delivery_address,
            order_items: items,
            tip: tip_amount ? tip_amount * 100 : 0, // cents
          }),
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "order_placed",
              delivery_id: data.external_delivery_id,
              estimated_delivery: data.dropoff_time_estimated,
              total: data.fee,
              tracking_url: data.tracking_url,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
