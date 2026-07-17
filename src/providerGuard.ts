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
 *  - cancellation/timeout: the MCP sender signal is combined with
 *    limits.timeoutMs and passed downstream (a cancelled or hung child process
 *    cannot keep consuming resources indefinitely);
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
// Prompts shorter than this are not scrubbed from error text: replacing a
// 1-3 char substring would mangle unrelated words, and such prompts carry no
// meaningful secret.
const MIN_PROMPT_SCRUB_CHARS = 4;

/**
 * Remove the submitted prompt from an error message. Upstream failures (child
 * CLI stderr, moderation/validation errors) may quote the prompt verbatim,
 * which the pattern-based redact() cannot catch — this enforces the
 * no-prompt-in-logs invariant on the error path.
 */
function scrubPrompt(message: string, prompt: string): string {
  if (prompt.length >= MIN_PROMPT_SCRUB_CHARS && message.includes(prompt)) {
    return message.split(prompt).join("[prompt-redacted]");
  }
  return message;
}

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

/**
 * Sanitize metadata echoed to clients/logs (structuredContent): redact
 * secret-shaped content, suppress the prompt, strip control characters, and
 * cap length. A provider must not be able to smuggle keys/JWTs/base64/prompt
 * text out through model/requestId fields.
 */
function sanitizeMeta(value: unknown, prompt: string): string {
  if (typeof value !== "string") {
    return "";
  }
  const scrubbed = redact(scrubPrompt(value, prompt));
  // eslint-disable-next-line no-control-regex
  return scrubbed.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, META_MAX_CHARS);
}

/**
 * Validate untrusted provider output; throws provider_failed on any violation.
 * `prompt` (when provided) is suppressed from metadata echoed back to clients.
 */
export function validateGenerateResult(
  raw: unknown,
  limits: Limits,
  providerKind: string,
  prompt = ""
): GenerateResult {
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

  // Bound the allocation BEFORE decoding (4 base64 chars decode to at most 3
  // bytes) so an absurdly large payload cannot OOM/stall the process while
  // being decoded just to be rejected afterwards.
  const maxDecodedBytes = (base64.length / 4) * 3;
  if (maxDecodedBytes > limits.maxImageBytes) {
    throw providerFailed(
      `Provider "${providerKind}" returned a base64 payload of at most ${maxDecodedBytes} decoded bytes; ` +
        `max is ${limits.maxImageBytes} (IMAGE_MCP_MAX_IMAGE_BYTES).`
    );
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
    model: sanitizeMeta(result.model, prompt) || "unknown",
    // Identity is server-assigned — a plugin cannot claim another lane's name.
    provider: providerKind as GenerateResult["provider"],
    requestId: sanitizeMeta(result.requestId, prompt) || "unknown"
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
    if (input.signal?.aborted) {
      throw providerFailed("Generation cancelled by the MCP client.");
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.limits.timeoutMs);
    const combinedSignal = input.signal
      ? AbortSignal.any([input.signal, timeoutController.signal])
      : timeoutController.signal;
    const timeoutWaiter = abortRejection(timeoutController.signal, () =>
      providerFailed(`Generation timed out after ${this.limits.timeoutMs}ms.`)
    );
    const cancellationWaiter = input.signal
      ? abortRejection(input.signal, () => providerFailed("Generation cancelled by the MCP client."))
      : undefined;
    try {
      // Async wrapper so a synchronously-throwing plugin still rejects.
      const generation = (async () => this.inner.generate({ ...input, signal: combinedSignal }))();
      // A rejection that loses the race (or lands after timeout) must not
      // become an unhandled rejection and crash the whole server.
      generation.catch(() => undefined);

      const contenders: Promise<GenerateResult>[] = [generation, timeoutWaiter.promise];
      if (cancellationWaiter) {
        contenders.push(cancellationWaiter.promise);
      }
      const raw = await Promise.race(contenders);
      return validateGenerateResult(raw, this.limits, this.inner.kind, input.prompt);
    } catch (err) {
      if (input.signal?.aborted && !timeoutController.signal.aborted) {
        throw providerFailed("Generation cancelled by the MCP client.");
      }
      if (err instanceof ImageError) {
        // Typed errors are safe by construction EXCEPT for upstream text they
        // may embed (which can quote the prompt) — scrub before rethrowing.
        throw new ImageError(err.code, redact(scrubPrompt(err.message, input.prompt)).slice(0, ERROR_MAX_CHARS));
      }
      const raw = err instanceof Error ? err.message : String(err);
      const message = redact(scrubPrompt(raw, input.prompt)).slice(0, ERROR_MAX_CHARS);
      throw providerFailed(`Provider "${this.inner.kind}" failed: ${message}`);
    } finally {
      clearTimeout(timer);
      timeoutWaiter.dispose();
      cancellationWaiter?.dispose();
    }
  }
}

interface AbortWaiter {
  promise: Promise<never>;
  dispose(): void;
}

/** Build a removable abort waiter so a long-lived client signal retains no request closures. */
function abortRejection(signal: AbortSignal, error: () => ImageError): AbortWaiter {
  let onAbort = (): void => undefined;
  const promise = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(error());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    dispose: () => signal.removeEventListener("abort", onAbort)
  };
}

/** Wrap a provider with the uniform guard. Applied to ALL providers in createProvider. */
export function guardProvider(inner: ImageProvider, limits: Limits): ImageProvider {
  return new GuardedImageProvider(inner, limits);
}
