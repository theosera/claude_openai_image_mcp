import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_API_VERSION, loadPluginProvider } from "claude-openai-image-mcp/provider";
import { loadCodexConfig } from "../src/config.js";
import { createCodexImageProvider } from "../src/codexProvider.js";
import { createImageProvider, providerApiVersion } from "../src/index.js";

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
// The host's guard is internal (not a package export); load its built artifact
// directly (repo root dist) so we validate against the REAL guard code.
const guardModulePath = fileURLToPath(new URL("../../../dist/providerGuard.js", import.meta.url));
const builtPluginPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const limits = { maxPromptChars: 2000, timeoutMs: 60_000, maxRetries: 0, maxConcurrency: 1, maxImageBytes: 15_728_640 };
const baseInput = { prompt: "a red circle", size: "1024x1024", quality: "low", format: "png" };

function codexProvider(fixtureName: string) {
  return createCodexImageProvider(
    loadCodexConfig("gpt-image-2", {
      CODEX_PLUGIN_COMMAND: fixture(fixtureName),
      CODEX_PLUGIN_ARGS: '["exec"]'
    })
  );
}

async function guard(inner: any) {
  const mod = (await import(guardModulePath)) as { guardProvider: (p: unknown, l: unknown) => any };
  return mod.guardProvider(inner, limits);
}

describe("contract compatibility with the host", () => {
  it("declares the same PROVIDER_API_VERSION the host expects", () => {
    expect(providerApiVersion).toBe(PROVIDER_API_VERSION);
  });

  it("createImageProvider returns a kind='plugin' provider", () => {
    expect(createImageProvider({ model: "gpt-image-2" }).kind).toBe("plugin");
  });
});

describe("output passes the host's real providerGuard", () => {
  it("a produced PNG round-trips through guardProvider", async () => {
    const guarded = await guard(codexProvider("fake-codex-success.mjs"));
    const res = await guarded.generate(baseInput);
    expect(res.provider).toBe("plugin");
    expect(res.mimeType).toBe("image/png");
    expect(typeof res.base64).toBe("string");
    expect(res.base64.length).toBeGreaterThan(0);
  });

  it("the provider detects actual PNG bytes when webp was requested", async () => {
    const guarded = await guard(codexProvider("fake-codex-success.mjs"));
    const res = await guarded.generate({ ...baseInput, format: "webp" });
    expect(res.mimeType).toBe("image/png");
  });
});

describe("the host's real loader accepts the built plugin", () => {
  it("loadPluginProvider imports dist/index.js and passes the version + kind gate", async () => {
    const provider = await loadPluginProvider(builtPluginPath, { model: "gpt-image-2", limits });
    expect(provider.kind).toBe("plugin");
  });
});
