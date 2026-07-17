import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { ImageError } from "../src/errors.js";
import { MOCK_PNG_BASE64, createProvider, type ImageProvider } from "../src/imageProvider.js";
import { loadLimits } from "../src/limits.js";
import { guardProvider, validateGenerateResult } from "../src/providerGuard.js";

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const pluginEnv = (name: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  IMAGE_MCP_PROVIDER: "plugin",
  IMAGE_MCP_PROVIDER_MODULE: fixturePath(name),
  ...extra
});

const input = { prompt: "x", size: "1024x1024", quality: "low", format: "png" };

describe("plugin lane config (startup, fail-closed)", () => {
  it("S1: provider=plugin without a module refuses to start", () => {
    expect(() => loadConfig({ IMAGE_MCP_PROVIDER: "plugin" })).toThrow(/IMAGE_MCP_PROVIDER_MODULE/);
  });

  it("keeps pluginModule out of config for the built-in lanes", () => {
    const cfg = loadConfig({ IMAGE_MCP_PROVIDER: "mock", IMAGE_MCP_PROVIDER_MODULE: "whatever" });
    expect(cfg.pluginModule).toBeUndefined();
  });
});

describe("plugin loading (startup, fail-closed)", () => {
  it("loads a well-behaved plugin and serves its image through the guard", async () => {
    const env = pluginEnv("plugin-valid.mjs");
    const provider = await createProvider(loadConfig(env), env);
    expect(provider.kind).toBe("plugin");

    const result = await provider.generate(input);
    expect(result.base64).toBe(MOCK_PNG_BASE64);
    expect(result.mimeType).toBe("image/png");
    expect(result.provider).toBe("plugin");
    // The plugin reports its backend's model, not necessarily the configured one.
    expect(result.model).toBe("backend-of-gpt-image-2");
    expect(result.requestId).toBe("fixture-1024x1024");
  });

  it("S2: refuses to start when the module does not resolve", async () => {
    const env = pluginEnv("does-not-exist.mjs");
    await expect(createProvider(loadConfig(env), env)).rejects.toThrow(/Failed to load provider plugin/);
  });

  it("S3: an import-time crash is fail-closed with the message redacted", async () => {
    const env = pluginEnv("plugin-throws-on-import.mjs");
    const rejection = expect(createProvider(loadConfig(env), env)).rejects;
    await rejection.toThrow(ImageError);
    await expect(createProvider(loadConfig(env), env)).rejects.not.toThrow(/abcdefghijklmnop/);
    await expect(createProvider(loadConfig(env), env)).rejects.toThrow(/sk-\*\*\*redacted\*\*\*/);
  });

  it("S4: a module without createImageProvider is rejected", async () => {
    const env = pluginEnv("plugin-missing-factory.mjs");
    await expect(createProvider(loadConfig(env), env)).rejects.toThrow(/createImageProvider/);
  });

  it("S5: a provider API version mismatch is rejected with both versions named", async () => {
    const env = pluginEnv("plugin-bad-version.mjs");
    await expect(createProvider(loadConfig(env), env)).rejects.toThrow(/999/);
    await expect(createProvider(loadConfig(env), env)).rejects.toThrow(/requires 1/);
  });

  it("S7: warns when OPENAI_API_KEY coexists with the plugin lane", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const env = pluginEnv("plugin-valid.mjs", { OPENAI_API_KEY: "sk-should-warn-not-be-used" });
    await createProvider(loadConfig(env), env);
    const written = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("provider.plugin.api_key_present");
    expect(written).not.toContain("sk-should-warn-not-be-used");
    spy.mockRestore();
  });

  it("S8: a stale module setting is ignored (with a warning) on built-in lanes", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const env = { IMAGE_MCP_PROVIDER: "mock", IMAGE_MCP_PROVIDER_MODULE: fixturePath("plugin-valid.mjs") };
    const provider = await createProvider(loadConfig(env), env);
    expect(provider.kind).toBe("mock");
    const written = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("provider.module_ignored");
    spy.mockRestore();
  });
});

describe("guard: untrusted plugin output at request time", () => {
  async function misbehaving(extra: NodeJS.ProcessEnv = {}) {
    const env = pluginEnv("plugin-misbehaving.mjs", extra);
    return createProvider(loadConfig(env), env);
  }

  it("R3: rejects a disallowed mimeType (SVG smuggling)", async () => {
    const provider = await misbehaving();
    await expect(provider.generate({ ...input, prompt: "svg" })).rejects.toThrow(/disallowed mimeType/);
  });

  it("R4: rejects bytes that do not match the claimed mimeType", async () => {
    const provider = await misbehaving();
    await expect(provider.generate({ ...input, prompt: "mime-mismatch" })).rejects.toThrow(/do not match/);
  });

  it("R2: rejects malformed base64", async () => {
    const provider = await misbehaving();
    await expect(provider.generate({ ...input, prompt: "bad-base64" })).rejects.toThrow(/malformed base64/);
  });

  it("R5: rejects an image larger than IMAGE_MCP_MAX_IMAGE_BYTES", async () => {
    const env = pluginEnv("plugin-valid.mjs", { IMAGE_MCP_MAX_IMAGE_BYTES: "16" });
    const provider = await createProvider(loadConfig(env), env);
    await expect(provider.generate(input)).rejects.toThrow(/max is 16/);
  });

  it("R5b: rejects an oversized base64 payload BEFORE decoding it", () => {
    const limits = { ...loadLimits({}), maxImageBytes: 16 };
    const oversized = {
      base64: "AAAA".repeat(100),
      mimeType: "image/png",
      model: "m",
      provider: "plugin",
      requestId: "r"
    };
    // 400 base64 chars bound to at most 300 decoded bytes — rejected pre-decode.
    expect(() => validateGenerateResult(oversized, limits, "plugin")).toThrow(/at most 300 decoded bytes/);
  });

  it("R8b: an upstream error quoting the prompt is scrubbed before surfacing", async () => {
    const provider = await misbehaving();
    const prompt = "echo-prompt-SECRET-USER-TEXT-42";
    const failure = provider.generate({ ...input, prompt });
    await expect(failure).rejects.toThrow(/prompt-redacted/);
    await expect(provider.generate({ ...input, prompt })).rejects.not.toThrow(/SECRET-USER-TEXT-42/);
  });

  it("R6: a hung plugin is aborted by the core timeout", async () => {
    const provider = await misbehaving({ IMAGE_MCP_TIMEOUT_MS: "50" });
    await expect(provider.generate({ ...input, prompt: "hang" })).rejects.toThrow(/timed out after 50ms/);
  });

  it("R6b: an MCP sender cancellation is combined with the guard timeout signal", async () => {
    let observedAbort = false;
    const inner: ImageProvider = {
      kind: "plugin",
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          const onAbort = (): void => {
            observedAbort = true;
            reject(new Error("inner observed abort"));
          };
          if (signal?.aborted) {
            onAbort();
          } else {
            signal?.addEventListener("abort", onAbort, { once: true });
          }
        })
    };
    const provider = guardProvider(inner, { ...loadLimits({}), timeoutMs: 5_000 });
    const controller = new AbortController();
    const generation = provider.generate({ ...input, signal: controller.signal });

    controller.abort();

    await expect(generation).rejects.toThrow(/cancelled by the MCP client/);
    expect(observedAbort).toBe(true);
  });

  it("R8: plugin error messages are redacted before surfacing (JWT does not leak)", async () => {
    const provider = await misbehaving();
    const failure = provider.generate({ ...input, prompt: "throw-with-secret" });
    await expect(failure).rejects.toThrow(/jwt-redacted/);
    await expect(provider.generate({ ...input, prompt: "throw-with-secret" })).rejects.not.toThrow(/eyJhbGci/);
  });

  it("R9b: secret-shaped or prompt-quoting metadata is redacted before structuredContent", async () => {
    const provider = await misbehaving();
    const result = await provider.generate({ ...input, prompt: "meta-smuggle" });
    expect(result.model).not.toContain("sk-abcdefghijklmnop123456");
    expect(result.model).toContain("sk-***redacted***");
    expect(result.model).toContain("[prompt-redacted]");
    expect(result.requestId).not.toContain("A".repeat(120));
    expect(result.requestId).toContain("base64-redacted");
  });

  it("R9: provider identity is server-assigned and metadata is sanitized", async () => {
    const provider = await misbehaving();
    const result = await provider.generate({ ...input, prompt: "spoof" });
    // The plugin claimed provider "openai"; the guard forces the truth.
    expect(result.provider).toBe("plugin");
    expect(result.model.length).toBeLessThanOrEqual(200);
    // eslint-disable-next-line no-control-regex
    expect(result.model).not.toMatch(/[\u0000-\u001f\u007f]/);
    // eslint-disable-next-line no-control-regex
    expect(result.requestId).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});
