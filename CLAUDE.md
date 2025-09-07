# CLAUDE.md

Hello! We're building a dxt, a desktop extension for Claude.

I believe that it should be self-contained, but am open to challenge and evidenced best practices.

## Filestructure

- ./doc contains documentation, notably the concept descriptions
- ./server contains the sourcecode
- ./node-modules contains our dependencies, notably beeminderjs
- ./manifest.json describes the server and its tools interface

## Technologies

- node.js because then desktop claude can run the server itself
- beeminderjs to access the beeminder api

## Working Practices

Respond as a helpful peer reviewer or pair programming partner.

Suggest changes and explain why, so that I can learn by making most edits myself.

Always syntax check my code for correctness.

Always check my code for potential compile-time or run-time errors.


