#!/usr/bin/env node
// Fake `codex` authenticated via a stored API key (NOT a ChatGPT subscription).
// `login status` reports authenticated but by API key — the subscription-only
// lane must reject this (P1-1). Current code wrongly accepts it, so the
// conformance spec for this fixture is `it.skip` until the auth-method check
// lands.
const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using API key\n");
  process.exit(0);
}
process.stdout.write("(would generate, billed against the API key)\n");
process.exit(0);
