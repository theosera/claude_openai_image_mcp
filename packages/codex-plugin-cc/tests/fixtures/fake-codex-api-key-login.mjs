#!/usr/bin/env node
// A persisted API-key login can exist without either API-key env var. The
// subscription-only provider must reject this successful but wrong auth method.
const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using an API key\n");
  process.exit(0);
}
process.stderr.write("exec must not run with API-key authentication\n");
process.exit(2);
