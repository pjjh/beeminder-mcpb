# Beeminder DXT

This project implements a bundled [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server for interacting with the [Beeminder](https://www.beeminder.com) API, packaged as a [desktop extension](https://www.anthropic.com/engineering/desktop-extensions).

## What is Beeminder?

Beeminder is a tool for overcoming akrasia (acting against your better judgment) by combining:
- Quantified self-tracking
- Visual feedback via a "Bright Red Line" (BRL) showing your commitment path
- Financial stakes that increase with each failure
- Flexible commitment with a 7-day "akrasia horizon"


## Concepts

Although this is a wrapper around the Beeminder API, it's reimagined for MCP use by focussing on user actions and tools.[^1] These are documented in .concept files in the doc folder, and roughly follow the ideas of Daniel Jackson.[^2]




## Acknowledgements

Thanks to Alex [@strickvl](https://github.com/strickvl) for his [MCP Beeminder](https://github.com/strickvl/mcp-beeminder) server, which inspired this project.

Thanks too, to [@malcolmocean](https://github.com/malcolmocean) for his
[`beeminderjs`](https://github.com/malcolmocean/beeminderjs) nodejs package,
on which this project is built.

And obviously thanks to the [Beeminder](https://www.beeminder.com) team for
building such a great product!


## Footnotes

[^1]: https://useai.substack.com/p/mcp-tool-design-from-apis-to-ai-first

[^2]: https://essenceofsoftware.com/posts/distillation/
