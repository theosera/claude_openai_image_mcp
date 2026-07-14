import process from "node:process";

/**
 * Minimal structured logger with hard redaction guarantees.
 *
 * Rules (security-critical, enforced here rather than by convention):
 *  - Logs go to STDERR only. On the stdio transport, STDOUT is reserved for the
 *    MCP protocol stream; writing logs there would corrupt it.
 *  - We NEVER log the API key, the raw prompt text, or image bytes/base64.
 *    Callers pass only metadata (sizes, formats, counts, durations, codes).
 *  - As defense in depth, `redact()` scrubs anything that looks like an OpenAI
 *    key or a long base64 blob before it is ever written.
 */

const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{16,}/g;
// A run of base64-ish chars long enough to be encoded image data (not a short
// id or a normal word). 80+ contiguous base64 chars is effectively always data.
const LONG_BASE64_PATTERN = /[A-Za-z0-9+/]{80,}={0,2}/g;

export function redact(value: string): string {
  return value.replace(OPENAI_KEY_PATTERN, "sk-***redacted***").replace(LONG_BASE64_PATTERN, "***base64-redacted***");
}

type Fields = Record<string, string | number | boolean | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields): void {
  const parts: string[] = [new Date().toISOString(), level.toUpperCase(), event];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined) {
      continue;
    }
    const value = typeof raw === "string" ? redact(raw) : String(raw);
    parts.push(`${key}=${value}`);
  }
  process.stderr.write(parts.join(" ") + "\n");
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}) => emit("error", event, fields)
};
