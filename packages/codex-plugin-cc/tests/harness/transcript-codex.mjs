#!/usr/bin/env node
// transcript-codex — an OBSERVATION-DERIVED fake `codex` for deterministic
// replay. Unlike the hand-written tests/fixtures/fake-codex-*.mjs (which encode
// an author's ASSUMPTIONS about how codex behaves), this driver replays a
// transcript that was RECORDED from a real codex run (see record.mjs). CI never
// touches the network or a ChatGPT subscription: it replays the committed
// transcript byte-for-byte.
//
// It is spawned exactly where the plugin would spawn the real `codex`, so it
// must honor the SAME two call shapes the #6 provider uses:
//
//   login preflight :  <this> login status
//   generation      :  <this> exec [<flags>…] "<prompt with file \"image.ext\">"
//
// Transcript resolution is deliberately arg/env-free by default. The host's
// login preflight spawns a FIXED `["login","status"]` argv through a strict env
// allowlist (see src/config.ts codexChildEnv), so neither an extra CLI flag nor
// a custom env var survives to the login call. This driver therefore resolves
// its transcript RELATIVE TO ITSELF, which works identically for the login and
// exec calls. An explicit `--transcript <path>` flag (present only on the exec
// argv) overrides the default when a test wants to select another recording.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const transcriptPath =
  flagValue("--transcript") ?? fileURLToPath(new URL("./transcripts/chatgpt-success.example.json", import.meta.url));

let transcript;
try {
  transcript = JSON.parse(readFileSync(transcriptPath, "utf8"));
} catch (err) {
  process.stderr.write(`transcript-codex: cannot read transcript "${transcriptPath}": ${err?.message ?? err}\n`);
  process.exit(70); // EX_SOFTWARE: a harness/config fault, not a codex outcome.
}

function emit(step) {
  if (typeof step?.stdout === "string") process.stdout.write(step.stdout);
  if (typeof step?.stderr === "string") process.stderr.write(step.stderr);
  process.exit(typeof step?.exitCode === "number" ? step.exitCode : 0);
}

// login preflight: `codex login status` → argv[0] === "login".
if (argv[0] === "login") {
  emit(transcript.login ?? { stdout: "Logged in using ChatGPT\n", exitCode: 0 });
}

// generation: the last argv element is the prompt; the provider embeds the
// target filename as file "image.ext". Write the recorded bytes there exactly
// as the real image tool would, then replay the recorded stdout/exit.
const exec = transcript.exec ?? {};
const prompt = argv[argv.length - 1] ?? "";
const match = prompt.match(/file "([^"]+)"/);
const filename = match ? match[1] : "image.png";

if (typeof exec.fileBase64 === "string" && exec.fileBase64.length > 0) {
  writeFileSync(join(process.cwd(), filename), Buffer.from(exec.fileBase64, "base64"));
}

emit(exec);
