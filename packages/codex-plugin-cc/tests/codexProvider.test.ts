import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codexChildEnv, loadCodexConfig } from "../src/config.js";
import { createCodexImageProvider } from "../src/codexProvider.js";

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const baseInput = { prompt: "a red circle", size: "1024x1024", quality: "low", format: "png" };

function provider(fixtureName: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const config = loadCodexConfig("gpt-image-2", {
    CODEX_PLUGIN_COMMAND: fixture(fixtureName),
    CODEX_PLUGIN_ARGS: '["exec","--full-auto"]',
    ...extraEnv
  });
  return createCodexImageProvider(config);
}

describe("config", () => {
  it("defaults to `codex exec --full-auto` and needs no API key", () => {
    const c = loadCodexConfig("gpt-image-2", {});
    expect(c.command).toBe("codex");
    expect(c.baseArgs).toEqual(["exec", "--full-auto"]);
    expect(c.preflightLogin).toBe(false);
  });

  it("parses CODEX_PLUGIN_ARGS as JSON or a plain string", () => {
    expect(loadCodexConfig("m", { CODEX_PLUGIN_ARGS: '["exec","--yolo"]' }).baseArgs).toEqual(["exec", "--yolo"]);
    expect(loadCodexConfig("m", { CODEX_PLUGIN_ARGS: "exec --yolo" }).baseArgs).toEqual(["exec", "--yolo"]);
  });

  it("codexChildEnv strips OPENAI_API_KEY (no fallback to API billing)", () => {
    const env = codexChildEnv({ OPENAI_API_KEY: "sk-should-be-gone", KEEP: "yes" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.KEEP).toBe("yes");
  });
});

describe("CodexImageProvider.generate", () => {
  it("returns a valid PNG with plugin identity and codex request id", async () => {
    const res = await provider("fake-codex-success.mjs").generate(baseInput);
    const bytes = Buffer.from(res.base64, "base64");
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(res.mimeType).toBe("image/png");
    expect(res.provider).toBe("plugin");
    expect(res.requestId).toMatch(/^codex-/);
    // Model is an honest, advisory label — never a pinned lie.
    expect(res.model).toMatch(/codex/i);
  });

  it("declares kind 'plugin' (the host guard requires this)", () => {
    expect(provider("fake-codex-success.mjs").kind).toBe("plugin");
  });

  it("maps a missing ChatGPT session to codex_not_logged_in", async () => {
    await expect(provider("fake-codex-not-logged-in.mjs").generate(baseInput)).rejects.toMatchObject({
      code: "codex_not_logged_in"
    });
  });

  it("maps a codex run that saves no file to codex_no_image", async () => {
    await expect(provider("fake-codex-no-image.mjs").generate(baseInput)).rejects.toMatchObject({
      code: "codex_no_image"
    });
  });

  it("maps a missing codex binary to codex_not_found", async () => {
    const config = loadCodexConfig("gpt-image-2", { CODEX_PLUGIN_COMMAND: "definitely-not-codex-xyz-42" });
    await expect(createCodexImageProvider(config).generate(baseInput)).rejects.toMatchObject({
      code: "codex_not_found"
    });
  });

  it("honors the host abort signal and terminates a hung codex", async () => {
    const controller = new AbortController();
    const promise = provider("fake-codex-hang.mjs").generate({ ...baseInput, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toMatchObject({ code: "codex_aborted" });
  });

  it("rejects immediately if the signal is already aborted", async () => {
    await expect(
      provider("fake-codex-success.mjs").generate({ ...baseInput, signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: "codex_aborted" });
  });
});

describe("preflight login check", () => {
  it("passes through to generate when logged in", async () => {
    const res = await provider("fake-codex-success.mjs", { CODEX_PLUGIN_PREFLIGHT_LOGIN: "1" }).generate(baseInput);
    expect(res.provider).toBe("plugin");
  });

  it("fails closed before generating when not logged in", async () => {
    await expect(
      provider("fake-codex-not-logged-in.mjs", { CODEX_PLUGIN_PREFLIGHT_LOGIN: "1" }).generate(baseInput)
    ).rejects.toMatchObject({ code: "codex_not_logged_in" });
  });
});
