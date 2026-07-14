import type { Limits } from "./limits.js";
import type { GenerateInput, GenerateResult, ImageProvider } from "./imageProvider.js";
import { providerUnavailable } from "./errors.js";

export interface OpenAIProviderOptions {
  /** Server-side API key. Held privately; never logged, never placed in AppConfig. */
  apiKey: string;
  model: string;
  limits: Limits;
}

/**
 * Phase 2 skeleton — INTENTIONALLY NOT WIRED to the network in Phase 1.
 *
 * When implemented it will call the official SDK:
 *
 *   const client = new OpenAI({ apiKey, timeout: limits.timeoutMs, maxRetries: limits.maxRetries });
 *   const res = await client.images.generate({
 *     model,            // e.g. "gpt-image-2" (server-owned)
 *     prompt: input.prompt,
 *     size: input.size,
 *     quality: input.quality,
 *     output_format: input.format,
 *     n: 1
 *   });
 *   const b64 = res.data[0].b64_json;   // gpt-image models always return base64
 *
 * ...then validate b64/bytes/MIME, map 429/Retry-After/timeout/5xx to typed
 * errors, and return a GenerateResult. Until that lands, generate() fails
 * closed so no untested live call (and no billing) can happen by accident.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly kind = "openai" as const;

  // Stored for Phase 2; the key is kept private and never serialized/logged.
  readonly #apiKey: string;
  readonly #model: string;
  readonly #limits: Limits;

  constructor(options: OpenAIProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#limits = options.limits;
  }

  async generate(_input: GenerateInput): Promise<GenerateResult> {
    // Reference private fields so the skeleton documents its inputs without
    // leaking them, and fail closed until Phase 2 wires the real call.
    void this.#apiKey;
    void this.#limits;
    throw providerUnavailable(
      `OpenAI provider (model=${this.#model}) is not wired yet. Use IMAGE_MCP_PROVIDER=mock until Phase 2 lands.`
    );
  }
}
