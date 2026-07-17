#!/usr/bin/env node
// Fake `codex` that authenticates through ChatGPT, then never finishes its exec.
// The host abort path must terminate it (SIGTERM to the process group, then
// SIGKILL after the grace).
const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
setInterval(() => {}, 1 << 30);
