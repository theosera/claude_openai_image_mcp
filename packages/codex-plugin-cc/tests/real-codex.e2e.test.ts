import { describe, expect, it } from "vitest";
import { createImageProvider } from "../src/index.js";

/**
 * Real-codex E2E — the ground truth the fake fixtures cannot provide.
 *
 * OPT-IN ONLY: runs only when CODEX_E2E=1. It drives the REAL `codex` binary,
 * so it needs an interactive `codex login` (ChatGPT subscription) and consumes
 * subscription quota. It is therefore never run in CI. Run it locally:
 *
 *   codex login                       # ChatGPT subscription
 *   cd packages/codex-plugin-cc
 *   pnpm run build
 *   CODEX_E2E=1 pnpm test real-codex
 *
 * This exercises the plugin↔real-codex boundary that P1-1/P1-3/P2-4 live on —
 * the boundary that fakes can only assume, not verify.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RUN = process.env.CODEX_E2E === "1";

describe.skipIf(!RUN)("real codex E2E (opt-in: CODEX_E2E=1; consumes ChatGPT subscription)", () => {
  it("generates a real PNG through the plugin", async () => {
    const provider = createImageProvider({ model: "gpt-image-2", limits: { maxImageBytes: 15_728_640 } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await provider.generate({
        prompt: "a single red circle centered on a white background, flat vector",
        size: "1024x1024",
        quality: "low",
        format: "png",
        signal: controller.signal
      });
      const bytes = Buffer.from(res.base64, "base64");
      expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect(res.provider).toBe("plugin");
      expect(res.requestId).toMatch(/^codex-/);
      // Model must be honest — an advisory label, never a pinned lie.
      expect(res.model).toMatch(/codex/i);
    } finally {
      clearTimeout(timer);
    }
  }, 200_000);
});
