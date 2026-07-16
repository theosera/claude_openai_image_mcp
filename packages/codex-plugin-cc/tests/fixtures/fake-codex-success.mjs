#!/usr/bin/env node
// Fake `codex` for tests: acts logged-in, and on `exec` writes a real 1x1 PNG
// to the filename quoted in the prompt (as the built-in image tool would).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "login") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}

const prompt = args[args.length - 1] ?? "";
const match = prompt.match(/file "([^"]+)"/);
const filename = match ? match[1] : "image.png";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
writeFileSync(join(process.cwd(), filename), PNG);
process.stdout.write(`Saved image to ${filename}\n`);
process.exit(0);
