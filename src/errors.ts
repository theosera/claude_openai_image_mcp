/**
 * Typed errors for the image MCP. Every error message is safe to surface to a
 * client and to write to logs: it MUST NOT embed the API key, the raw prompt
 * text, or image bytes. Callers map these to MCP tool errors.
 */

export type ImageErrorCode =
  | "config_invalid" // env/config is malformed or missing a required value
  | "validation_failed" // request failed schema/allowlist checks before any API call
  | "provider_unavailable" // provider misconfigured (e.g. openai selected but no key)
  | "provider_failed"; // upstream call failed (network/timeout/upstream error) — Phase 2

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = "ImageError";
    this.code = code;
  }
}

/** Config problem (missing/invalid env). Fail-closed at startup. */
export function configError(message: string): ImageError {
  return new ImageError("config_invalid", message);
}

/** Request rejected before any external call (allowlist/bounds violation). */
export function validationError(message: string): ImageError {
  return new ImageError("validation_failed", message);
}

/** Selected provider cannot run (e.g. openai without a key). */
export function providerUnavailable(message: string): ImageError {
  return new ImageError("provider_unavailable", message);
}

/**
 * Normalize an unknown thrown value into a short, secret-free string. Never
 * returns the raw object (which could carry request bodies / headers with the
 * key). Used both for logging and for the message returned to the client.
 */
export function toSafeMessage(err: unknown): string {
  if (err instanceof ImageError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
