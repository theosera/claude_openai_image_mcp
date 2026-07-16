#!/usr/bin/env node
// Fake `codex` whose `login status` reports "logged in" ONLY when no API-key
// env var is present. Used to prove the login preflight strips API keys before
// spawning codex (else a leftover key would let codex report API-key auth).
const args = process.argv.slice(2);
if (args[0] === "login") {
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
    process.stderr.write("Authenticated via API key, not a ChatGPT session.\n");
    process.exit(1);
  }
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
process.stdout.write("exec not used in this fixture\n");
process.exit(0);
