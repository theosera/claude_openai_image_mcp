#!/usr/bin/env node
// Recorder: run REAL codex once and capture its behavior as a transcript that
// transcript-codex.mjs can replay in CI (no billing, no login on CI). This is
// how a fake becomes observation-derived instead of author-derived.
//
// Usage (local, logged in to codex; consumes subscription quota):
//   node tests/harness/record.mjs > tests/harness/transcripts/chatgpt-success.json
//
// It records BOTH `codex login status` and one `codex exec …` that saves an
// image into a throwaway scratch dir, then emits the transcript JSON to stdout.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CODEX = process.env.CODEX_PLUGIN_COMMAND || "codex";
const EXEC_ARGS = JSON.parse(process.env.CODEX_PLUGIN_ARGS || '["exec","--full-auto","--skip-git-repo-check"]');
const PROMPT =
  process.argv[2] ||
  'a single red circle on white, flat vector. Task: generate exactly one image and save it as the file "image.png" in the current working directory. Only write the file.';

function run(args, cwd) {
  const r = spawnSync(CODEX, args, { cwd, encoding: "utf8", timeout: 180_000 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exit: r.status ?? -1 };
}

const login = run(["login", "status"], process.cwd());

const scratch = mkdtempSync(join(tmpdir(), "codex-record-"));
let exec;
try {
  const raw = run([...EXEC_ARGS, PROMPT], scratch);
  const files = readdirSync(scratch);
  const image = files.find((f) => /\.(png|webp|jpe?g)$/i.test(f));
  exec = {
    stdout: raw.stdout,
    stderr: raw.stderr,
    exit: raw.exit,
    filesWritten: files,
    writeFileFromPrompt: Boolean(image),
    fileBase64: image ? readFileSync(join(scratch, image)).toString("base64") : null
  };
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ recordedAt: "REDACTED", login, exec }, null, 2) + "\n");
