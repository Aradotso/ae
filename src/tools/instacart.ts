import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const INSTACART_BASE = "https://connect.instacart.com";

async function instacartFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.INSTACART_API_KEY;

  if (!apiKey) {
    throw new Error("Instacart API key not configured on server");
  }

  const res = await fetch(`${INSTACART_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instacart API error ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerInstacartTools(server: McpServer) {
  server.tool(
    "search_products",
    "Search for grocery products on Instacart",
    {
      query: z.string().describe("Search query (e.g. 'organic bananas', 'chicken breast')"),
      store: z.string().optional().describe("Preferred store name (e.g. 'Costco', 'Whole Foods', 'Safeway')"),
      limit: z.number().optional().default(10).describe("Max results to return"),
    },
    async ({ query, store, limit }) => {
      try {
        const data = await instacartFetch("/idp/v1/products/search", {
          method: "POST",
          body: JSON.stringify({
            query,
            ...(store && { store_name: store }),
            limit,
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
    "search_stores",
    "Find nearby Instacart-supported stores by location",
    {
      zip_code: z.string().describe("ZIP code to search near"),
      store_name: z.string().optional().describe("Filter by store name (e.g. 'Costco')"),
    },
    async ({ zip_code, store_name }) => {
      try {
        const data = await instacartFetch("/idp/v1/retailers/search", {
          method: "POST",
          body: JSON.stringify({
            postal_code: zip_code,
            ...(store_name && { name: store_name }),
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
    "create_cart",
    "Create an Instacart cart with items for delivery. Requires user confirmation before checkout.",
    {
      items: z.array(z.object({
        product_id: z.string().describe("Product ID from search results"),
        quantity: z.number().default(1),
      })).describe("Items to add to cart"),
      delivery_address: z.string().describe("Full delivery address"),
      store_id: z.string().optional().describe("Store/retailer ID from search results"),
    },
    async ({ items, delivery_address, store_id }) => {
      try {
        const data = await instacartFetch("/idp/v1/orders", {
          method: "POST",
          body: JSON.stringify({
            items: items.map(i => ({
              product_id: i.product_id,
              quantity: i.quantity,
            })),
            delivery_address,
            ...(store_id && { retailer_id: store_id }),
          }),
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "cart_created",
              order_id: data.id,
              checkout_url: data.checkout_url,
              estimated_total: data.estimated_total,
              estimated_delivery: data.estimated_delivery_time,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "check_order_status",
    "Check the status of an Instacart order",
    {
      order_id: z.string().describe("Order ID from create_cart"),
    },
    async ({ order_id }) => {
      try {
        const data = await instacartFetch(`/idp/v1/orders/${order_id}`);
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
