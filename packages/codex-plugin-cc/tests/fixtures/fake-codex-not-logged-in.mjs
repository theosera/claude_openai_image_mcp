#!/usr/bin/env node
// Fake `codex` with no ChatGPT session: fails both `login status` and `exec`.
process.stderr.write("Error: Not logged in. Run `codex login` to authenticate.\n");
process.exit(1);
