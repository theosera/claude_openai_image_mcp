import { ImageError, providerFailed } from "./errors.js";
import type { GenerateInput, GenerateResult, ImageProvider } from "./imageProvider.js";
import type { Limits } from "./limits.js";
import { redact } from "./logging.js";

/**
 * Uniform request-time guard wrapped around EVERY provider (mock, openai,
 * plugin). Provider output is treated as untrusted data: with an external
 * plugin in the chain, "the provider behaves" is no longer an invariant the
 * core can assume, so the core enforces it here instead:
 *
 *  - timeout: generate() is raced against limits.timeoutMs and aborted via
 *    AbortSignal (a hung plugin/child process cannot wedge the server);
 *  - result validation: strict base64, decoded-size cap, MIME allowlist, and
 *    magic-byte check (bytes must BE what the mimeType claims — no SVG/HTML
 *    smuggling); metadata strings are sanitized and length-capped;
 *  - provider identity: the result's provider field is forced to the wrapped
 *    provider's kind (a plugin cannot report itself as "openai");
 *  - error hygiene: non-ImageError failures (e.g. a child process stderr
 *    embedded in an Error message) are redacted and truncated before they can
 *    reach logs or the client.
 */

/** MIME types the server will ever return; anything else is rejected. */
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/webp", "image/jpeg"]);

// Strict base64: Node's Buffer.from(_, "base64") silently ignores invalid
// characters, so shape-check before decoding.
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const META_MAX_CHARS = 200;
const ERROR_MAX_CHARS = 300;

function magicBytesMatch(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "image/png":
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC);
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
    default:
      return false;
  }
}

/** Strip control characters and cap length for metadata echoed to clients/logs. */
function sanitizeMeta(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, META_MAX_CHARS);
}

/** Validate untrusted provider output; throws provider_failed on any violation. */
export function validateGenerateResult(raw: unknown, limits: Limits, providerKind: string): GenerateResult {
  if (typeof raw !== "object" || raw === null) {
    throw providerFailed(`Provider "${providerKind}" returned a non-object result.`);
  }
  const result = raw as Record<string, unknown>;

  const mimeType = result.mimeType;
  if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw providerFailed(`Provider "${providerKind}" returned a disallowed mimeType.`);
  }

  const base64 = result.base64;
  if (typeof base64 !== "string" || base64.length === 0 || base64.length % 4 !== 0 || !STRICT_BASE64.test(base64)) {
    throw providerFailed(`Provider "${providerKind}" returned malformed base64 image data.`);
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    throw providerFailed(`Provider "${providerKind}" returned an empty image.`);
  }
  if (bytes.length > limits.maxImageBytes) {
    throw providerFailed(
      `Provider "${providerKind}" returned ${bytes.length} bytes; max is ${limits.maxImageBytes} (IMAGE_MCP_MAX_IMAGE_BYTES).`
    );
  }
  if (!magicBytesMatch(bytes, mimeType)) {
    throw providerFailed(`Provider "${providerKind}" returned bytes that do not match the claimed mimeType.`);
  }

  return {
    base64,
    mimeType,
    model: sanitizeMeta(result.model) || "unknown",
    // Identity is server-assigned — a plugin cannot claim another lane's name.
    provider: providerKind as GenerateResult["provider"],
    requestId: sanitizeMeta(result.requestId) || "unknown"
  };
}

class GuardedImageProvider implements ImageProvider {
  readonly kind: ImageProvider["kind"];

  constructor(
    private readonly inner: ImageProvider,
    private readonly limits: Limits
  ) {
    this.kind = inner.kind;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);
    try {
      // Async wrapper so a synchronously-throwing plugin still rejects.
      const generation = (async () => this.inner.generate({ ...input, signal: controller.signal }))();
      // A rejection that loses the race (or lands after timeout) must not
      // become an unhandled rejection and crash the whole server.
      generation.catch(() => undefined);

      const raw = await Promise.race([generation, timeoutRejection(controller.signal, this.limits.timeoutMs)]);
      return validateGenerateResult(raw, this.limits, this.inner.kind);
    } catch (err) {
      if (err instanceof ImageError) {
        throw err;
      }
      const message = redact(err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX_CHARS);
      throw providerFailed(`Provider "${this.inner.kind}" failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function timeoutRejection(signal: AbortSignal, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(providerFailed(`Generation timed out after ${ms}ms.`)), {
      once: true
    });
  });
}

/** Wrap a provider with the uniform guard. Applied to ALL providers in createProvider. */
export function guardProvider(inner: ImageProvider, limits: Limits): ImageProvider {
  return new GuardedImageProvider(inner, limits);
}
