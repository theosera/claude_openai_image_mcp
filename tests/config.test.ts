import { describe, expect, it } from "vitest";
import { loadConfig, mimeTypeForFormat } from "../src/config.js";
import { ImageError } from "../src/errors.js";

// A minimal env that produces a valid mock config.
const baseEnv = (): NodeJS.ProcessEnv => ({ IMAGE_MCP_PROVIDER: "mock" });

describe("loadConfig", () => {
  it("defaults to the mock provider and gpt-image-2 with sane allowlists", () => {
    const cfg = loadConfig({});
    expect(cfg.provider).toBe("mock");
    expect(cfg.model).toBe("gpt-image-2");
    expect(cfg.allowed.sizes).toContain("1024x1024");
    expect(cfg.allowed.qualities).toEqual(["low", "medium"]);
    expect(cfg.allowed.formats).toEqual(["png", "webp", "jpeg"]);
    expect(cfg.defaults).toEqual({ size: "1024x1024", quality: "low", format: "png" });
  });

  it("rejects an unknown provider", () => {
    expect(() => loadConfig({ IMAGE_MCP_PROVIDER: "gemini" })).toThrow(ImageError);
  });

  it("rejects a non-integer numeric limit", () => {
    expect(() => loadConfig({ ...baseEnv(), IMAGE_MCP_MAX_PROMPT_CHARS: "lots" })).toThrow(/non-negative integer/);
  });

  it("rejects a zero concurrency (must be >= 1)", () => {
    expect(() => loadConfig({ ...baseEnv(), IMAGE_MCP_MAX_CONCURRENCY: "0" })).toThrow(/positive integer/);
  });

  it("allows zero retries", () => {
    const cfg = loadConfig({ ...baseEnv(), IMAGE_MCP_MAX_RETRIES: "0" });
    expect(cfg.limits.maxRetries).toBe(0);
  });

  it("rejects an unsupported quality in the allowlist", () => {
    expect(() => loadConfig({ ...baseEnv(), IMAGE_MCP_ALLOWED_QUALITIES: "ultra" })).toThrow(/Unsupported quality/);
  });

  it("rejects an unsupported format in the allowlist", () => {
    expect(() => loadConfig({ ...baseEnv(), IMAGE_MCP_ALLOWED_FORMATS: "gif" })).toThrow(/Unsupported format/);
  });

  it("rejects a malformed size in the allowlist", () => {
    expect(() => loadConfig({ ...baseEnv(), IMAGE_MCP_ALLOWED_SIZES: "huge" })).toThrow(/Invalid size/);
  });

  it("rejects a default that is outside its allowlist", () => {
    expect(() =>
      loadConfig({ ...baseEnv(), IMAGE_MCP_ALLOWED_FORMATS: "png", IMAGE_MCP_DEFAULT_FORMAT: "webp" })
    ).toThrow(/not in IMAGE_MCP_ALLOWED_FORMATS/);
  });

  it("narrows allowlists from env", () => {
    const cfg = loadConfig({ ...baseEnv(), IMAGE_MCP_ALLOWED_FORMATS: "png", IMAGE_MCP_ALLOWED_SIZES: "1024x1024" });
    expect(cfg.allowed.formats).toEqual(["png"]);
    expect(cfg.allowed.sizes).toEqual(["1024x1024"]);
  });
});

describe("mimeTypeForFormat", () => {
  it("maps known formats", () => {
    expect(mimeTypeForFormat("png")).toBe("image/png");
    expect(mimeTypeForFormat("webp")).toBe("image/webp");
    expect(mimeTypeForFormat("jpeg")).toBe("image/jpeg");
  });

  it("throws for an unknown format", () => {
    expect(() => mimeTypeForFormat("gif")).toThrow(ImageError);
  });
});
