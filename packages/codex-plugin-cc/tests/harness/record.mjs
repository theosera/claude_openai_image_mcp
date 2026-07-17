#!/usr/bin/env node
// record — capture a REAL codex run into a replayable transcript. This is how a
// transcript under transcripts/ is produced from ground truth instead of an
// author's assumptions. It is OPT-IN and consumes your ChatGPT subscription
// (like real-codex.e2e.test.ts), so it is never run in CI. Run it locally:
//
//   codex login                                  # ChatGPT subscription
//   cd packages/codex-plugin-cc && pnpm run build
//   node tests/harness/record.mjs > tests/harness/transcripts/chatgpt-success.json
//
// Then replay it deterministically via transcript-codex.mjs (see harness.test.ts).
//
// The captured exec invocation mirrors the #6 provider exactly: the same default
// baseArgs and the same file "image.<ext>" prompt shape, so a recording is a
// faithful stand-in for what the plugin actually sends.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMMAND = process.env.CODEX_PLUGIN_COMMAND?.trim() || "codex";
// Keep in lockstep with src/config.ts loadCodexConfig() default baseArgs.
const EXEC_ARGS = [
  "exec",
  "--sandbox",
  "workspace-write",
  "--ephemeral",
  "--ignore-user-config",
  "--skip-git-repo-check"
];
const PROMPT_TEXT =
  process.env.CODEX_RECORD_PROMPT?.trim() || "a single red circle centered on a white background, flat vector";
const FILENAME = "image.png";

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(COMMAND, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? null }));
  });
}

function buildPrompt() {
  // Mirror src/codexProvider.ts buildPrompt() so the recording matches production.
  return (
    `${PROMPT_TEXT}\n\n` +
    `Task: generate exactly one image and save it as the file "${FILENAME}" ` +
    `in the current working directory. Target size 1024x1024, quality low, ` +
    `format png. Do not print the image data or any commentary; only write the file.`
  );
}

async function main() {
  const login = await run(["login", "status"], process.cwd());
  const scratch = await mkdtemp(join(tmpdir(), "codex-record-"));
  try {
    const exec = await run([...EXEC_ARGS, buildPrompt()], scratch);
    let fileBase64;
    try {
      fileBase64 = (await readFile(join(scratch, FILENAME))).toString("base64");
    } catch {
      fileBase64 = "";
    }
    const transcript = {
      $schema: "codex-transcript/v1",
      note: "Recorded from a real codex run via tests/harness/record.mjs. Replayed by transcript-codex.mjs.",
      recorded: { command: COMMAND, execArgs: EXEC_ARGS },
      login: { stdout: login.stdout, stderr: login.stderr, exitCode: login.exitCode },
      exec: { stdout: exec.stdout, stderr: exec.stderr, exitCode: exec.exitCode, fileBase64, fileMimeHint: "image/png" }
    };
    process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  process.stderr.write(`record: ${err?.message ?? err}\n`);
  process.exit(1);
});
