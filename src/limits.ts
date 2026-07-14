import { configError } from "./errors.js";

/**
 * Numeric guardrails for a single generate_image request.
 *
 * All values are PROVISIONAL (see README "Provisional values"): they exist to
 * bound cost, latency, and fan-out before any real API call is wired in
 * (Phase 2). Each carries a review condition so we tune it from E2E evidence
 * rather than guesswork.
 */
export interface Limits {
  /** Reject prompts longer than this many characters (bounds token/cost). */
  maxPromptChars: number;
  /** Per-request upstream timeout in ms. Review: raise if high-quality/large sizes time out. */
  timeoutMs: number;
  /** Bounded retries for transient upstream failures. Review: >0 only once 429/5xx handling exists. */
  maxRetries: number;
  /** Max concurrent in-flight generations. Review: raise once cost per call is understood. */
  maxConcurrency: number;
}

// Fallbacks used when the corresponding env var is unset/empty. Kept small on
// purpose — a local, single-user server does not need aggressive concurrency.
const DEFAULTS: Limits = {
  maxPromptChars: 2000,
  timeoutMs: 60_000,
  maxRetries: 0,
  maxConcurrency: 1
};

/** Parse a non-negative integer env override, or fall back. Rejects garbage. */
function nonNegativeInt(name: string, raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n < 0 || String(n) !== trimmed) {
    throw configError(`Invalid ${name}="${raw}". Must be a non-negative integer.`);
  }
  return n;
}

/** Parse a positive integer env override (>=1), or fall back. Rejects garbage. */
function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  const n = nonNegativeInt(name, raw, fallback);
  if (n < 1) {
    throw configError(`Invalid ${name}="${raw}". Must be a positive integer (>= 1).`);
  }
  return n;
}

export function loadLimits(env: NodeJS.ProcessEnv): Limits {
  return {
    maxPromptChars: positiveInt("IMAGE_MCP_MAX_PROMPT_CHARS", env.IMAGE_MCP_MAX_PROMPT_CHARS, DEFAULTS.maxPromptChars),
    timeoutMs: positiveInt("IMAGE_MCP_TIMEOUT_MS", env.IMAGE_MCP_TIMEOUT_MS, DEFAULTS.timeoutMs),
    maxRetries: nonNegativeInt("IMAGE_MCP_MAX_RETRIES", env.IMAGE_MCP_MAX_RETRIES, DEFAULTS.maxRetries),
    maxConcurrency: positiveInt("IMAGE_MCP_MAX_CONCURRENCY", env.IMAGE_MCP_MAX_CONCURRENCY, DEFAULTS.maxConcurrency)
  };
}
