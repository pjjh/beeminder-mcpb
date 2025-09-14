# Beeminder DXT

This project implements a bundled [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server for interacting with the [Beeminder](https://www.beeminder.com) API, packaged as a [desktop extension](https://www.anthropic.com/engineering/desktop-extensions).

Use at your own risk; Beeminder involves real money commitments.

## What is Beeminder?

Beeminder is a tool for overcoming akrasia (acting against your better judgment) by combining:
- Quantified self-tracking
- Visual feedback via a "Bright Red Line" (BRL) showing your commitment path
- Financial stakes that increase with each failure
- Flexible commitment with a 7-day "akrasia horizon"


## Concepts

Although this is a wrapper around the Beeminder API, it's reimagined for MCP use by focussing on user actions and tools.[^1] These are documented in .concept files in the doc folder, and roughly follow the ideas of Daniel Jackson.[^2]

These tools improve on Beeminder's default processing by
* reflecting the impact of a goal's autoratchet setting on urgency
* grouping goals according to the user's experienced day, i.e. what needs to be tackled before bed

## Tools

### Add Datapoint
- Record Progress - adds a datapoint for today, and reports on resulting goal status
- Record Progress for Yesterday - adds a datapoint for yesterday, and reports on resulting goal status

### Dashboard
- List Goals - view all of your goals, in the canonical sort order (adjusted for any impending autoratchet)
- Beemergencies - view your eep! goals, whether they're due before bed or not until your tomorrow
- Calendial - list those goals that are due in the week following the akrasia horizon

## Planned Tools

### Review Goal
- Review Progress
- Analyse Goal

### Adjust Commitment
- Change Slope
- Schedule Break


## Security

This requires your [personal Beeminder token](https://www.beeminder.com/api/v1/auth_token.json), which gives access to all of your goals and to the api methods including the charge me now call.

The MacOS Claude client masks this token on entry, but displays it in plaintext in the developer extension settings tab.

Use at your own risk. No guarantees, warantees, etc. are made in respect of the code or how your AI companion invokes the tools.


## Acknowledgements

Thanks to Alex [@strickvl](https://github.com/strickvl) for his 
[MCP Beeminder](https://github.com/strickvl/mcp-beeminder) server, 
which inspired this project.

Thanks too, to [@malcolmocean](https://github.com/malcolmocean) for his
[`beeminderjs`](https://github.com/malcolmocean/beeminderjs) nodejs package,
on which this project is built.

Thanks also, to [@anthropics](https://github.com/anthropics) for their
[`hello world`](https://github.com/anthropics/mcpb/tree/main/examples/hello-world-node)
example, which served as the foundation.

And obviously thanks to the [Beeminder](https://www.beeminder.com) team for
building such a great product!


## Footnotes

[^1]: https://useai.substack.com/p/mcp-tool-design-from-apis-to-ai-first

[^2]: https://essenceofsoftware.com/posts/distillation/
