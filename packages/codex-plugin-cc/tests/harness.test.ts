import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCodexConfig } from "../src/config.js";
import { createCodexImageProvider } from "../src/codexProvider.js";

/**
 * Record/replay harness test — proves the plugin produces a valid image from an
 * OBSERVATION-DERIVED transcript (recorded from real codex; see
 * tests/harness/record.mjs) rather than only from author-written fakes. The
 * driver is spawned exactly where the real `codex` would be, so this exercises
 * the same two call shapes the #6 provider uses: the mandatory
 * `codex login status` preflight and the `codex exec` generation, both replayed
 * from the committed transcript with no network and no ChatGPT subscription.
 */

const driver = fileURLToPath(new URL("./harness/transcript-codex.mjs", import.meta.url));
const transcriptPath = fileURLToPath(new URL("./harness/transcripts/chatgpt-success.example.json", import.meta.url));
// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const baseInput = { prompt: "a red circle", size: "1024x1024", quality: "low", format: "png" };

// Deliberately DO NOT override CODEX_PLUGIN_ARGS: replay through the PRODUCTION
// default baseArgs (sandbox/ephemeral/ignore-config/skip-git-repo-check) so a
// regression in those defaults is actually exercised by the replay, and the
// driver is spawned with the same command shape production uses.
function replayProvider(extraEnv: NodeJS.ProcessEnv = {}) {
  return createCodexImageProvider(loadCodexConfig("gpt-image-2", { CODEX_PLUGIN_COMMAND: driver, ...extraEnv }));
}

describe("record/replay harness (observation-derived fake codex)", () => {
  it("replays a recorded ChatGPT transcript into a valid PNG with plugin identity", async () => {
    const res = await replayProvider().generate(baseInput);
    const bytes = Buffer.from(res.base64, "base64");
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(res.mimeType).toBe("image/png");
    expect(res.provider).toBe("plugin");
    // requestId is server-assigned per run; the transcript never dictates it.
    expect(res.requestId).toMatch(/^codex-/);
  });

  it("clears the mandatory ChatGPT login preflight from the same transcript", async () => {
    // The preflight spawns a fixed ["login","status"] argv through a stripped
    // env allowlist (src/config.ts codexChildEnv), so the driver has no arg/env
    // channel on that call — it resolves the transcript relative to itself. A
    // successful generate() proves the recorded login handshake replayed.
    const res = await replayProvider().generate(baseInput);
    expect(res.provider).toBe("plugin");
  });

  it("detects the actual PNG bytes even when webp was requested", async () => {
    const res = await replayProvider().generate({ ...baseInput, format: "webp" });
    // MIME is derived from the replayed bytes, never from the request.
    expect(res.mimeType).toBe("image/png");
  });

  it("replays with the production default codex argv (guards default-baseArgs drift)", () => {
    // The provider defaults, the committed transcript's recorded.execArgs, and
    // record.mjs must all agree — otherwise the replay would exercise a command
    // shape production never uses. Pin the three-way alignment here.
    const { baseArgs } = loadCodexConfig("gpt-image-2", { CODEX_PLUGIN_COMMAND: driver });
    const transcript = JSON.parse(readFileSync(transcriptPath, "utf8")) as { recorded?: { execArgs?: string[] } };
    expect(baseArgs).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check"
    ]);
    expect(transcript.recorded?.execArgs).toEqual(baseArgs);
  });
});
