import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ImageError } from "../src/errors.js";
import { MOCK_PNG_BASE64, MockImageProvider, createProvider } from "../src/imageProvider.js";

const fixture = readFileSync(fileURLToPath(new URL("../fixtures/pixel.png.b64", import.meta.url)), "utf8").trim();

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("MockImageProvider", () => {
  it("returns the fixture PNG with a matching mimeType", async () => {
    const provider = new MockImageProvider("gpt-image-2");
    const result = await provider.generate({ prompt: "a cat", size: "1024x1024", quality: "low", format: "webp" });

    expect(result.base64).toBe(fixture);
    expect(result.base64).toBe(MOCK_PNG_BASE64);
    // mimeType describes the ACTUAL bytes (png), regardless of requested format.
    expect(result.mimeType).toBe("image/png");
    expect(result.provider).toBe("mock");
    expect(result.model).toBe("gpt-image-2");
    expect(result.requestId).toMatch(/^mock-/);
  });

  it("emits base64 that decodes to a valid PNG", async () => {
    const provider = new MockImageProvider("gpt-image-2");
    const result = await provider.generate({ prompt: "x", size: "1024x1024", quality: "low", format: "png" });
    const bytes = Buffer.from(result.base64, "base64");
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});

describe("createProvider", () => {
  it("builds a mock provider without any key", () => {
    const cfg = loadConfig({ IMAGE_MCP_PROVIDER: "mock" });
    const provider = createProvider(cfg, {});
    expect(provider.kind).toBe("mock");
  });

  it("fails closed when openai is selected without a key (no secret leaked)", () => {
    const cfg = loadConfig({ IMAGE_MCP_PROVIDER: "openai" });
    expect(() => createProvider(cfg, {})).toThrow(ImageError);
    expect(() => createProvider(cfg, { OPENAI_API_KEY: "   " })).toThrow(/requires OPENAI_API_KEY/);
  });

  it("builds the openai provider when a key is present, but generate is not wired yet", async () => {
    const cfg = loadConfig({ IMAGE_MCP_PROVIDER: "openai" });
    const provider = createProvider(cfg, { OPENAI_API_KEY: "sk-test-should-not-appear" });
    expect(provider.kind).toBe("openai");
    await expect(provider.generate({ prompt: "x", size: "1024x1024", quality: "low", format: "png" })).rejects.toThrow(
      /not wired yet/
    );
  });
});
