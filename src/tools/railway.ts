import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RAILWAY_BASE = "https://backboard.railway.com/graphql/v2";

async function railwayFetch(query: string, variables: Record<string, unknown> = {}) {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) {
    throw new Error("Railway API token not configured on server");
  }

  const res = await fetch(RAILWAY_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Railway API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Railway GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

export function registerRailwayTools(server: McpServer) {
  server.tool(
    "railway_list_projects",
    "List all Railway projects",
    {},
    async () => {
      try {
        const data = await railwayFetch(`
          query {
            projects {
              edges {
                node {
                  id
                  name
                  description
                  updatedAt
                }
              }
            }
          }
        `);
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
    "railway_get_project",
    "Get details of a Railway project by ID, including its services and deployments",
    {
      id: z.string().describe("The Railway project ID"),
    },
    async ({ id }) => {
      try {
        const data = await railwayFetch(`
          query ($id: String!) {
            project(id: $id) {
              id
              name
              description
              updatedAt
              services {
                edges {
                  node {
                    id
                    name
                    updatedAt
                  }
                }
              }
              deployments {
                edges {
                  node {
                    id
                    status
                    createdAt
                  }
                }
              }
            }
          }
        `, { id });
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
    "railway_deploy_service",
    "Trigger a redeploy of a Railway service",
    {
      serviceId: z.string().describe("The Railway service ID to redeploy"),
    },
    async ({ serviceId }) => {
      try {
        const data = await railwayFetch(`
          mutation ($serviceId: String!) {
            serviceInstanceRedeploy(serviceId: $serviceId)
          }
        `, { serviceId });
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
    "railway_get_logs",
    "Get deployment logs from Railway",
    {
      deploymentId: z.string().describe("The Railway deployment ID"),
      limit: z.number().optional().default(100).describe("Number of log lines to retrieve"),
    },
    async ({ deploymentId, limit }) => {
      try {
        const data = await railwayFetch(`
          query ($id: String!, $limit: Int) {
            deploymentLogs(deploymentId: $id, limit: $limit) {
              timestamp
              message
              severity
            }
          }
        `, { id: deploymentId, limit });
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
