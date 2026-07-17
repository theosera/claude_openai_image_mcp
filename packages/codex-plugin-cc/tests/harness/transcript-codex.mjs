#!/usr/bin/env node
// Transcript-driven fake `codex`: replays a RECORDED interaction instead of an
// author-invented one. Point CODEX_PLUGIN_COMMAND at this file and set
// CODEX_TRANSCRIPT to a transcript JSON (see tests/harness/transcripts/*.json,
// produced by record.mjs against real codex).
//
// This is the core of the "spec-derived, not author-derived" fix: the fake's
// behavior comes from observing real codex, so it can drift-check against
// reality instead of quietly confirming assumptions.
//
// Transcript schema:
//   {
//     "login":  { "stdout": "...", "stderr": "", "exit": 0 },
//     "exec":   { "stdout": "...", "stderr": "", "exit": 0,
//                 "writeFileFromPrompt": true,      // save to the "file "<name>"" in the prompt
//                 "fileBase64": "<base64 of the image bytes to write>" }
//   }
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const transcriptPath = process.env.CODEX_TRANSCRIPT;
if (!transcriptPath) {
  process.stderr.write("transcript-codex: CODEX_TRANSCRIPT is not set\n");
  process.exit(64);
}
const transcript = JSON.parse(readFileSync(transcriptPath, "utf8"));
const args = process.argv.slice(2);
const step = args[0] === "login" ? transcript.login : transcript.exec;

if (!step) {
  process.stderr.write(`transcript-codex: no recorded step for args ${JSON.stringify(args)}\n`);
  process.exit(65);
}
if (step.stdout) process.stdout.write(step.stdout);
if (step.stderr) process.stderr.write(step.stderr);

if (args[0] !== "login" && step.writeFileFromPrompt && step.fileBase64) {
  const prompt = args[args.length - 1] ?? "";
  const match = prompt.match(/file "([^"]+)"/);
  const filename = match ? match[1] : "image.png";
  writeFileSync(join(process.cwd(), filename), Buffer.from(step.fileBase64, "base64"));
}

process.exit(step.exit ?? 0);
