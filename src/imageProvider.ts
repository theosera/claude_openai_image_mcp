import { randomUUID } from "node:crypto";
import process from "node:process";
import type { AppConfig, ProviderKind } from "./config.js";
import { providerUnavailable } from "./errors.js";
import { OpenAIImageProvider } from "./openaiImageClient.js";

/** A validated, allowlist-checked request (produced by the server layer). */
export interface GenerateInput {
  prompt: string;
  size: string;
  quality: string;
  format: string;
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
 * size/quality/output_format are still echoed by the server in structuredContent.
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
 * Build the provider selected by config. FAIL-CLOSED for the openai provider:
 * if OPENAI_API_KEY is missing/empty we throw a secret-free error at startup
 * rather than constructing a half-configured client. The key is read here and
 * handed to the client; it never enters AppConfig (which is loggable).
 */
export function createProvider(config: AppConfig, env: NodeJS.ProcessEnv = process.env): ImageProvider {
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
