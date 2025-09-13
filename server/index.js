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
      {
        name: "list_goals",
        description: "Get a complete list of the user's Beeminder goals with current status for effort prioritization",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
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
  else if (request.params.name === "list_goals") {
    return await listGoals();
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});


// TOOL IMPLEMENTATIONS

async function listGoals() {
  try {
    const bm = await bmndr();
    
    const user = await bm.getUserSkinny();
    const goals = user.goals || [];
    
    const goalsWithStatus = await Promise.all(goals.map(async (goal) => {
      let safeDays = goal.safebuf;
      let loseDate = goal.losedate;
      let urgencykey = goal.urgencykey;
      
      // If latest datapoint was added today, autoratchet hasn't run yet
      // so we need to manually adjust safe days and losedate
      if (goal.last_datapoint && goal.last_datapoint.timestamp) {
        const lastDatapointAge = NOW() - goal.last_datapoint.timestamp;
        const isFromToday = lastDatapointAge < SECONDS_PER_DAY;
        
        if (isFromToday) {
          try {
            // Fetch full goal data to get autoratchet value
            const fullGoal = await bm.getGoal(goal.slug);
            const adjusted = adjustForAutoratchet(fullGoal);
            safeDays = adjusted.safeDays;
            loseDate = adjusted.loseDate;
            
            // Update urgencykey with adjusted deadline
            if (loseDate !== goal.losedate) {
              const keyParts = goal.urgencykey.split(';');
              keyParts[2] = 'DL' + loseDate.toString().padStart(10, '0');
              urgencykey = keyParts.join(';');
            }
          } catch (error) {
            // If fetch fails, use unadjusted values
            console.error(`BMNDR: Failed to fetch full goal data for ${goal.slug}:`, error.message);
          }
        }
      }
      
      const urgencyHorizon = getUrgencyHorizon(loseDate);
      const dueBy = new Date(loseDate * 1000).toISOString();
      
      return {
        slug: goal.slug,
        title: goal.title,
        urgency_horizon: urgencyHorizon,
        safe_days: safeDays,
        due_by: dueBy,
        rate: `${goal.rate} ${goal.runits} per ${goal.gunits}`,
        current_value: goal.curval,
        target_value: goal.goalval,
        urgencykey: urgencykey
      };
    }));
    
    // Sort by urgencykey after potential adjustments
    goalsWithStatus.sort((a, b) => a.urgencykey.localeCompare(b.urgencykey));
    
    const goalsList = goalsWithStatus.map(goal => 
      `**${goal.slug}** (${goal.urgency_horizon})\n` +
      `  ${goal.title}\n` +
      `  Safe days: ${goal.safe_days} | Due: ${goal.due_by}\n` +
      `  Rate: ${goal.rate} | Current: ${goal.current_value} → ${goal.target_value}`
    ).join('\n\n');
    
    return {
      content: [
        {
          type: "text",
          text: `Found ${goalsWithStatus.length} goals (sorted by urgency):\n\n${goalsList}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message || error.name || 'Unknown error occurred while fetching goals'}`,
        },
      ],
    };
  }
}

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
      const datapointResult = await bm.createDatapoint(goal_slug, datapointParams);

      // Wait for Beeminder server to process the datapoint
      // getUser().updated_at changes before the goal has actually recalculated itself, so we can't use that
      // so we'll do a relatively heavy poll waiting for the graph to finish processing
      let queued = true;
      let goalStatus = undefined;
      while (queued) {
        await setTimeout(2000);
        goalStatus = await bm.callApi(`/users/me/goals/${goal_slug}.json`, { emaciated: true }, 'GET');
        queued = goalStatus.queued;
      }
      console.error("BMNDR: No longer queued");

      const { safeDays, loseDate, dueBy } = adjustForAutoratchet( goalStatus );

      const urgencyHorizon = getUrgencyHorizon( loseDate );

      return {
        content: [
          {
            type: "text",
            text: `Progress recorded successfully!\n\nDatapoint ID: ${datapointResult.id}\nValue recorded: ${value}${comment ? `\nComment: ${comment}` : ""}\n\nGoal Status:\n- Safe days: ${safeDays}\n- Urgency horizon: ${urgencyHorizon}\n- Due by: ${dueBy}\n- Goal rate: ${goalStatus.rate} ${goalStatus.runits} per ${goalStatus.gunits}`,
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

// return Unix timestamp of tomorrow morning
// will be off during DST changes, but that shouldn't affect usage here
function MORNING() {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Sets the time to midnight (00:00:00.000)
  const midnightTimestamp = now.getTime(); // Gets the timestamp in milliseconds
  return Math.floor( midnightTimestamp / 1000 + SECONDS_PER_DAY + getDayStart() );
}

// return seconds past midnight for DAY_START
const _dayStartDefault = 7 * 3600; // default 7am
let _dayStartSeconds = _dayStartDefault;
let _dayStartString = null;
function getDayStart() {
  const timeStr = process.env.DAY_START;
  if (!timeStr) return _dayStartDefault;

  if ( _dayStartString !== timeStr ) {
    const match = timeStr.match(/^\s*(\d{1,2})(:(\d{2}))?\s*(am|pm)?\s*$/i);
    if (!match) {
      console.error(`BMNDR: Unable to parse DAY_START "${timeStr}"...`);
      _dayStartString = timeStr;
      _dayStartSeconds = _dayStartDefault;
      return _dayStartSeconds;
    }

    let [, hours, , minutes, ampm] = match; // skip full match and the colon
    hours = parseInt(hours);
    minutes = minutes ? parseInt(minutes) : 0;

    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && hours !== 12) hours += 12;
      if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
    }

    _dayStartString = timeStr;
    _dayStartSeconds = hours * 3600 + minutes * 60;
  }
  return _dayStartSeconds;
}


// return { safeDays, loseDate, dueBy }, adjusted for autoratchet if applicable
function adjustForAutoratchet( goalStatus ) {

      let safeDays = goalStatus.safebuf; 
      let loseDate = goalStatus.losedate;

      // autoratchet kicks in at day end so won't yet be reflected in safebuf
      if (typeof goalStatus.autoratchet === 'number' && goalStatus.autoratchet >= 0) {
        const autoratchet = goalStatus.autoratchet + 1; // +1 to include today
        if (safeDays > autoratchet) {
          const daysToSubtract = safeDays - (autoratchet); 
          loseDate = goalStatus.losedate - (daysToSubtract * SECONDS_PER_DAY);
        }
        safeDays = Math.min(safeDays, autoratchet);
      }

      const dueBy = new Date(loseDate * 1000).toISOString();

  return { safeDays, loseDate, dueBy };
}


// return a string describing how urgent it is to make progress on this
function getUrgencyHorizon( losedate = NOW() ) {

      // how urgent
      if ( losedate <= MORNING() ) {
        // before bed today
        return "today";
      } 
      else if ( losedate <= MORNING() + SECONDS_PER_DAY ) {
        // before bed tomorrow
        return "tomorrow";
      } 
      else {
        // within akh or calendial or safesafesafe
        const secondsLeft = losedate - NOW();
        const daysLeft = Math.floor( secondsLeft / SECONDS_PER_DAY );
        if ( daysLeft <= 8 ) {
          return "committed"
        }
        else if ( daysLeft <= 15 ) {
          return "calendial"
        }
        else {
          return "safe"
        }
      }
}



// Start the server
const transport = new StdioServerTransport();
server.connect(transport);

console.error("BMNDR: Beeminder MCP server running...");
