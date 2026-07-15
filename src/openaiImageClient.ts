import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { mimeTypeForFormat } from "./config.js";
import { type ImageError, providerFailed, providerUnavailable } from "./errors.js";
import type { GenerateInput, GenerateResult, ImageProvider } from "./imageProvider.js";
import type { Limits } from "./limits.js";
import { redact } from "./logging.js";

/**
 * The narrow slice of the OpenAI SDK this provider uses. Injectable so tests
 * can mock-reproduce every upstream branch (429/timeout/5xx/missing data)
 * without network, keys, or billing.
 */
export interface ImagesApi {
  generate(
    body: OpenAI.Images.ImageGenerateParams,
    options?: { signal?: AbortSignal }
  ): Promise<{ data?: Array<{ b64_json?: string }> }>;
}

export interface OpenAIProviderOptions {
  /** Server-side API key. Held privately; never logged, never placed in AppConfig. */
  apiKey: string;
  model: string;
  limits: Limits;
  /** Test seam: defaults to the real SDK client built from apiKey/limits. */
  imagesApi?: ImagesApi;
}

const ERROR_MAX_CHARS = 200;

/** Shorten + redact an upstream message before it can reach logs or clients. */
function safeUpstreamMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redact(raw).slice(0, ERROR_MAX_CHARS);
}

/**
 * Map SDK failures to typed, secret-free errors. The SDK itself already
 * performed bounded retries (maxRetries honors Retry-After for 429/5xx), so
 * whatever reaches here is final for this request.
 */
function mapOpenAIError(err: unknown): ImageError {
  if (err instanceof OpenAI.AuthenticationError) {
    return providerUnavailable("OpenAI rejected the API key (401). Check OPENAI_API_KEY.");
  }
  if (err instanceof OpenAI.RateLimitError) {
    const headers = err.headers as { get?: (name: string) => string | null } | undefined;
    const retryAfter = typeof headers?.get === "function" ? headers.get("retry-after") : null;
    return providerFailed(
      `OpenAI rate limit hit (429).${retryAfter ? ` Retry after ${retryAfter}s.` : " Retry later."}`
    );
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return providerFailed("OpenAI request timed out.");
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return providerFailed("Could not reach the OpenAI API (connection error).");
  }
  if (err instanceof OpenAI.APIError) {
    return providerFailed(`OpenAI API error (status ${err.status ?? "unknown"}): ${safeUpstreamMessage(err)}`);
  }
  return providerFailed(`Unexpected error calling OpenAI: ${safeUpstreamMessage(err)}`);
}

/**
 * Live OpenAI Images provider (Phase 2). The inputs are already validated and
 * allowlist-checked by the server layer, and the output still passes through
 * providerGuard (magic-byte/MIME/size checks) — this class only owns the
 * upstream call and its error mapping.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly kind = "openai" as const;

  readonly #images: ImagesApi;
  readonly #model: string;

  constructor(options: OpenAIProviderOptions) {
    this.#model = options.model;
    this.#images =
      options.imagesApi ??
      new OpenAI({
        apiKey: options.apiKey,
        // The guard enforces timeoutMs end-to-end as well; setting it here too
        // lets the SDK fail fast per attempt instead of eating the whole budget.
        timeout: options.limits.timeoutMs,
        maxRetries: options.limits.maxRetries
      }).images;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    let response: { data?: Array<{ b64_json?: string }> };
    try {
      response = await this.#images.generate(
        {
          model: this.#model,
          prompt: input.prompt,
          size: input.size as OpenAI.Images.ImageGenerateParams["size"],
          quality: input.quality as OpenAI.Images.ImageGenerateParams["quality"],
          output_format: input.format as OpenAI.Images.ImageGenerateParams["output_format"],
          // n=1 is provisional (cost bound); review before allowing multi-image.
          n: 1
        },
        { signal: input.signal }
      );
    } catch (err) {
      throw mapOpenAIError(err);
    }

    // gpt-image models always return base64 (no URL mode).
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      throw providerFailed("OpenAI returned no image data (missing b64_json).");
    }

    const requestId = (response as { _request_id?: string | null })._request_id ?? `openai-${randomUUID()}`;
    return {
      base64: b64,
      // The requested format; providerGuard verifies the actual bytes match.
      mimeType: mimeTypeForFormat(input.format),
      model: this.#model,
      provider: this.kind,
      requestId
    };
  }
}
