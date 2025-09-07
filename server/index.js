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


/* Lazy Singleton: Create one validated beeminder object per server instance.
 * Must await the call to bmndr():
 * const bm = await bmndr();
 */
let _bmndr = null;
async function bmndr() {

  // lazy loading
  if ( _bmndr !== null ) {
    return _bmndr;
  }

  const authToken = process.env.AUTH_TOKEN;
  if (!authToken) {
    return {
      content: [
        {
          type: "text",
          text: "Error: AUTH_TOKEN environment variable not set. Please configure your Beeminder authentication token in settings.",
        },
      ],
    };
  }
  try {
    _bmndr = beeminder(authToken);
    await _bmndr.getUser(); // check auth
    return _bmndr;
  } catch (error) {
    _bmndr = null; // unassign
    if (error.status === 401 || error.status === 422) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Authentication failed. Please check your configuration contains a valid Beeminder Auth Token.`,
          },
        ],
      };
    }
    else {
      throw error;
    }
  }

  throw new Error( "Error: 'Unknown error occurred while connecting to Beeminder'" );
}



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
      {
        name: "record_progress_for_yesterday",
        description: "Add a datapoint to a Beeminder goal on yesterday's date and receive updated goal status",
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
    return await createAndCheckDatapoint( goal_slug, value, comment, NOW() );
  }
  else if (request.params.name === "record_progress_for_yesterday") {
    const { goal_slug, value, comment = "" } = request.params.arguments;
    return await createAndCheckDatapoint( goal_slug, value, comment, NOW() - SECONDS_PER_DAY );
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});


// TOOL IMPLEMENTATIONS

/* underlying calls for record_progress and record_progress_for_yesterday */
async function createAndCheckDatapoint( goal_slug, value, comment = "", timestamp = NOW() ) {

    try {
      const bm = await bmndr(); 

      const datapointParams = {
        value: value,
        comment: comment,
        timestamp: timestamp,
      };

      console.error("BMNDR: Creating Datapoint");
//      const last_losedate = (await bm.getGoal(goal_slug)).losedate;
      const datapointResult = await bm.createDatapoint(goal_slug, datapointParams);

      // Wait for Beeminder server to process the datapoint
      // getUser().updated_at changes before the goal has actually recalculated itself, so we can't use that
      // getGoal().last_datapoint also changes before the due date recalculations
      // so we'll do a heavy poll waiting to see whether there's been an impact on the goal's losedate
      // which of course there might not be, for intraday incremental progress
 /*     for ( let i = 0; i < 5; i++ ) {
        await setTimeout(1000);
        let losedate = (await bm.getGoal(goal_slug)).losedate;
        if ( last_losedate !== losedate ) {
          console.error(`BMNDR: Waited ${i+1} second${ i ? 's' : ''}`);
          break;
        }
      }
  */

      // hardcode waiting a few seconds for processing; no guarantee that the data's not stale
      await setTimeout(3000);
      const goalStatus = await bm.getGoal(goal_slug);

      // Cap safe days with autoratchet if it's set
      let safeDays = Math.floor((goalStatus.losedate - timestamp) / SECONDS_PER_DAY);
      if (typeof goalStatus.autoratchet === 'number' && goalStatus.autoratchet >= 0) {
        safeDays = Math.min(safeDays, goalStatus.autoratchet);
      }
      const dueBy = new Date(goalStatus.losedate * 1000).toISOString();

      const urgencyLevel = (safeDays <= 1 ? 3 : (safeDays <= 7 ? 2 : 1)); // FIXME - instead of 1 2 3, let's go with today, tomorrow, this_week, later

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


// UTILITIES

const SECONDS_PER_DAY = 24*60*60;

// JS works in milliseconds, Unix in seconds
function NOW() {
  const ms = Date.now();
  return ( Math.floor( ms / 1000 ) );
}


// Start the server
const transport = new StdioServerTransport();
server.connect(transport);

console.error("BMNDR: Beeminder MCP server running...");
