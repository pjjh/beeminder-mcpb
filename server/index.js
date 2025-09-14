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
        description: "Get a complete list of the user's Beeminder goals with current status for effort prioritization. Returns JSON with goals sorted by Beeminder's canonical urgency order.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "beemergencies",
        description: "Get goals that need attention before bed today or tomorrow. Returns JSON with goals sorted by Beeminder's canonical urgency order.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "calendial",
        description: "Returns goals in the 'calendial window' - typically 8-15 days out, beyond the akrasia horizon but close enough to warrant calendar planning. These goals benefit from advance scheduling and aren't urgent fires to fight, but should be considered when planning your week ahead.",
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
  else if (request.params.name === "beemergencies") {
    return await listGoals((goal) => 
      goal.safe_days === 0
    );
  }
  else if (request.params.name === "calendial") {
    return await listGoals((goal) => 
      goal.urgency_horizon === 'calendial'
    );
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});


// TOOL IMPLEMENTATIONS

async function getGoalDetails(bm, goal, needsFullDataFilter) {
  let safeDays = goal.safebuf;
  let loseDate = goal.losedate;
  let urgencykey = goal.urgencykey;
  let goalData = goal; // start with skinny data
  let alreadyHaveFullData = false;
  
  // Check if we need autoratchet adjustment
  const needsAutoratchetCheck = goal.last_datapoint && 
    goal.last_datapoint.timestamp &&
    (NOW() - goal.last_datapoint.timestamp) < SECONDS_PER_DAY;
    
  // Fetch full goal data if we need it for autoratchet
  if (needsAutoratchetCheck) {
    try {
      goalData = await getEmaciatedGoal(bm, goal.slug);
      alreadyHaveFullData = true;
      
      // Apply autoratchet adjustment
      const adjusted = adjustForAutoratchet(goalData);
      safeDays = adjusted.safeDays;
      loseDate = adjusted.loseDate;
      urgencykey = adjusted.urgencykey;
    } catch (error) {
      console.error(`BMNDR: Failed to fetch full goal data for ${goal.slug}:`, error.message);
    }
  }
  
  // Build processed goal for testing
  const processedGoal = {
    urgency_horizon: getUrgencyHorizon(loseDate),
    due_by: formatDueDate(loseDate),
    safe_days: safeDays,
    safebuf: safeDays,
    rate_description: `${goal.rate} ${goal.runits} per ${goal.gunits}`,
    current_value: goal.curval,
    target_value: goal.goalval,
    urgencykey: urgencykey,
    // Include original fields for filter testing
    slug: goal.slug,
    title: goal.title,
    description: goal.description,
  };
  
  // Check if caller wants full data based on processed goal
  const shouldGetFullData = needsFullDataFilter(processedGoal);
  
  // Fetch full goal data if needed and not already fetched
  if (shouldGetFullData && !alreadyHaveFullData) {
    try {
      goalData = await getEmaciatedGoal(bm, goal.slug);
      alreadyHaveFullData = true;
    } catch (error) {
      console.error(`BMNDR: Failed to fetch full goal data for ${goal.slug}:`, error.message);
    }
  }
  
  // Add full goal fields if we have them
  if (alreadyHaveFullData) {
    processedGoal.fineprint = goalData.fineprint || "";
  }
  
  return processedGoal;
}

async function listGoals(urgencyFilter = null) {
  try {
    const bm = await bmndr();
    
    const user = await bm.getUserSkinny();
    const goals = user.goals || [];
    
    // Determine if we need full data based on the filter
    const needsFullDataFilter = urgencyFilter ? 
      (goal) => urgencyFilter(goal) : 
      (goal) => false;
    
    // Use getGoalDetails with appropriate full data filter
    const goalsWithStatus = await Promise.all(goals.map(async (goal) => {
      return await getGoalDetails(bm, goal, needsFullDataFilter);
    }));
    
    // Apply urgency filter if provided
    let filteredGoals = goalsWithStatus;
    if (urgencyFilter) {
      filteredGoals = goalsWithStatus.filter(urgencyFilter);
    }
    
    // Sort by urgencykey after potential adjustments
    filteredGoals.sort((a, b) => a.urgencykey.localeCompare(b.urgencykey));
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: filteredGoals.length,
            goals: filteredGoals
          }, null, 2),
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
        goalStatus = await getEmaciatedGoal(bm, goal_slug);
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

// Fetch full goal data with emaciated flag (strips road/roadall for efficiency)
async function getEmaciatedGoal(bm, goalSlug) {
  return await bm.callApi(`/users/me/goals/${goalSlug}.json`, { emaciated: true }, 'GET');
}

// Format Unix timestamp as user-friendly local time
function formatDueDate(losedate) {
  return new Date(losedate * 1000).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

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


// return { safeDays, loseDate, dueBy, urgencykey }, adjusted for autoratchet if applicable
function adjustForAutoratchet( goal ) {

      let safeDays = goal.safebuf; 
      let loseDate = goal.losedate;

      // autoratchet kicks in at day end so won't yet be reflected in safebuf
      if (typeof goal.autoratchet === 'number' && goal.autoratchet >= 0) {
        const autoratchet = goal.autoratchet + 1; // +1 to include today
        if (safeDays > autoratchet) {
          const daysToSubtract = safeDays - (autoratchet); 
          loseDate = goal.losedate - (daysToSubtract * SECONDS_PER_DAY);
        }
        safeDays = Math.min(safeDays, autoratchet);
      }

      const dueBy = formatDueDate(loseDate);

      // Update urgencykey if loseDate changed
      let urgencykey = goal.urgencykey;
      if (loseDate !== goal.losedate) {
        const keyParts = goal.urgencykey.split(';');
        keyParts[2] = 'DL' + loseDate.toString().padStart(10, '0');
        urgencykey = keyParts.join(';');
      }

  return { safeDays, loseDate, dueBy, urgencykey };
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
        if ( daysLeft <= 7 ) {
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
