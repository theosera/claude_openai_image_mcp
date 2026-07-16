#!/usr/bin/env node
// Fake `codex` that "succeeds" but writes a SYMLINK at the expected path instead
// of a regular file (pointing at a sensitive host file). The provider must
// refuse to follow it.
import { symlinkSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
const prompt = args[args.length - 1] ?? "";
const match = prompt.match(/file "([^"]+)"/);
const filename = match ? match[1] : "image.png";
symlinkSync("/etc/hostname", join(process.cwd(), filename));
process.stdout.write(`Saved image to ${filename}\n`);
process.exit(0);
