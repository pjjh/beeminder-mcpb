#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from 'module';
import { setTimeout } from 'timers/promises';
const require = createRequire(import.meta.url);
const beeminder = require("beeminder");

const server = new Server(
  {
    name: "beeminder",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  return {
    tools: [
      {
        name: "record_progress",
        description: "Add a datapoint to a Beeminder goal and receive updated goal status",
        inputSchema: {
          type: "object",
          properties: {
            goal_slug: {
              type: "string",
              description: "The goal slug identifier for the Beeminder goal",
            },
            value: {
              type: "number",
              description: "The numeric value to record as progress",
            },
            comment: {
              type: "string",
              description: "Optional comment to add to the datapoint",
              default: "",
            },
          },
          required: ["goal_slug", "value"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {

  if (request.params.name === "record_progress") {
    const { goal_slug, value, comment = "" } = request.params.arguments;

    const authToken = process.env.AUTH_TOKEN;
    if (!authToken) {
      return {
        content: [
          {
            type: "text",
            text: "Error: AUTH_TOKEN environment variable not set. Please configure your Beeminder authentication token.",
          },
        ],
      };
    }

    try {
      const bm = beeminder(authToken);
      
      const datapointParams = {
        value: value,
        comment: comment,
      };

      const datapointResult = await bm.createDatapoint(goal_slug, datapointParams);

      // Wait for Beeminder server to process the datapoint
      await setTimeout(500);

      const goalStatus = await bm.getGoal(goal_slug);

      const safeDays = Math.floor((goalStatus.losedate - Date.now() / 1000) / (24 * 60 * 60));
      const urgencyLevel = goalStatus.yaw > 0 ? 1 : (safeDays <= 1 ? 3 : (safeDays <= 7 ? 2 : 1));
      const dueBy = new Date(goalStatus.losedate * 1000).toISOString();

      return {
        content: [
          {
            type: "text",
            text: `Progress recorded successfully!\n\nDatapoint ID: ${datapointResult.id}\nValue recorded: ${value}${comment ? `\nComment: ${comment}` : ""}\n\nGoal Status:\n- Safe days: ${safeDays}\n- Urgency level: ${urgencyLevel} (1=green, 2=blue, 3=orange/red)\n- Due by: ${dueBy}\n- Goal rate: ${goalStatus.rate} ${goalStatus.runits} per ${goalStatus.gunits}`,
          },
        ],
      };
    } catch (error) {
      if (error.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Goal '${goal_slug}' not found. Please check the goal slug or list your goals to find the correct identifier.`,
            },
          ],
        };
      } else if (error.status === 401 || error.status === 422) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Authentication failed. Please check your configuration contains a valid Beeminder Auth Token.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message || error.name || 'Unknown error occurred while recording progress'}`,
            },
          ],
        };
      }
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start the server
const transport = new StdioServerTransport();
server.connect(transport);

console.error("Hello World MCP server running...");
