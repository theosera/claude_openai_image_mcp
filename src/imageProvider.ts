import { randomUUID } from "node:crypto";
import process from "node:process";
import type { AppConfig, ProviderKind } from "./config.js";
import { configError, providerUnavailable } from "./errors.js";
import { log } from "./logging.js";
import { OpenAIImageProvider } from "./openaiImageClient.js";
import { loadPluginProvider } from "./providerContract.js";
import { guardProvider } from "./providerGuard.js";

/** A validated, allowlist-checked request (produced by the server layer). */
export interface GenerateInput {
  prompt: string;
  size: string;
  quality: string;
  format: string;
  /**
   * Fired by the guard on timeout. Providers SHOULD stop work when it fires;
   * a provider that spawns child processes MUST kill them (no zombies holding
   * credentials or upstream connections).
   */
  signal?: AbortSignal;
}

/** Provider output. `base64` has NO data-URL prefix (MCP ImageContent shape). */
export interface GenerateResult {
  base64: string;
  /** MIME type of the actual returned bytes (matches the base64 payload). */
  mimeType: string;
  model: string;
  provider: ProviderKind;
  requestId: string;
}

export interface ImageProvider {
  readonly kind: ProviderKind;
  generate(input: GenerateInput): Promise<GenerateResult>;
}

/**
 * Canonical 1x1 transparent PNG, base64, no data-URL prefix. This is the mock
 * provider's response body — a real, decodable PNG so the MCP ImageContent
 * round-trips exactly like a live image, but with zero network and zero cost.
 * Kept in sync with fixtures/pixel.png.b64 (asserted in tests).
 */
export const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Offline provider. Returns a fixed 1x1 PNG regardless of the requested format,
 * so `mimeType` always describes the ACTUAL bytes (image/png). The requested
 * format and actual PNG format are reported separately by the server.
 */
export class MockImageProvider implements ImageProvider {
  readonly kind = "mock" as const;

  constructor(private readonly model: string) {}

  async generate(_input: GenerateInput): Promise<GenerateResult> {
    return {
      base64: MOCK_PNG_BASE64,
      mimeType: "image/png",
      model: this.model,
      provider: this.kind,
      requestId: `mock-${randomUUID()}`
    };
  }
}

/**
 * Build the provider selected by config, wrapped in the uniform guard
 * (timeout + untrusted-output validation + error hygiene — see providerGuard).
 * FAIL-CLOSED everywhere: openai without a key, or a plugin that fails to
 * load/handshake, aborts startup with a secret-free error rather than exposing
 * a half-configured tool.
 */
export async function createProvider(config: AppConfig, env: NodeJS.ProcessEnv = process.env): Promise<ImageProvider> {
  return guardProvider(await createInnerProvider(config, env), config.limits);
}

async function createInnerProvider(config: AppConfig, env: NodeJS.ProcessEnv): Promise<ImageProvider> {
  if (config.provider === "plugin") {
    if (!config.pluginModule) {
      throw configError("IMAGE_MCP_PROVIDER=plugin requires IMAGE_MCP_PROVIDER_MODULE.");
    }
    // The subscription-style plugin lane needs no API key. Keeping the key in
    // the same process gives in-process plugin code a chance to read it —
    // detectable but not preventable, so at least warn loudly.
    if (env.OPENAI_API_KEY?.trim()) {
      log.warn("provider.plugin.api_key_present", {
        hint: "OPENAI_API_KEY is set but unused by the plugin lane; remove it from this process's env"
      });
    }
    return loadPluginProvider(config.pluginModule, { model: config.model, limits: config.limits });
  }

  if (env.IMAGE_MCP_PROVIDER_MODULE?.trim()) {
    // Never let a stale module setting destabilize the built-in lanes.
    log.warn("provider.module_ignored", { provider: config.provider });
  }

  if (config.provider === "mock") {
    return new MockImageProvider(config.model);
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw providerUnavailable(
      "IMAGE_MCP_PROVIDER=openai requires OPENAI_API_KEY. Refusing to start the OpenAI provider without a key."
    );
  }
  return new OpenAIImageProvider({ apiKey, model: config.model, limits: config.limits });
}
