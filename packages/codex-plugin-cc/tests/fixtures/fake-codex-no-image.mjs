#!/usr/bin/env node
// Fake `codex` that succeeds but declines to write a file (prompt refused, or a
// version that saves elsewhere). Exercises the codex_no_image path.
const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
process.stdout.write("I considered the request but did not save an image.\n");
process.exit(0);
