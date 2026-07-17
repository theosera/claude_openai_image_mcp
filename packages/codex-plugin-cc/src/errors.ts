/**
 * Typed, secret-free errors for the codex plugin. Messages are safe to surface:
 * they never embed the prompt, tokens, or image bytes. The host's providerGuard
 * additionally redacts/truncates whatever we throw, but we stay clean at source.
 */

export type CodexErrorCode =
  | "codex_not_found" // the codex binary could not be spawned (not installed / not on PATH)
  | "codex_not_logged_in" // codex has no ChatGPT session (run `codex login`)
  | "codex_wrong_auth" // codex is authenticated, but not through ChatGPT
  | "codex_failed" // codex exited non-zero for another reason
  | "codex_no_image" // codex exited 0 but produced no image file
  | "codex_aborted"; // the host aborted the request (timeout / cancellation)

export class CodexError extends Error {
  readonly code: CodexErrorCode;

  constructor(code: CodexErrorCode, message: string) {
    super(message);
    this.name = "CodexError";
    this.code = code;
  }
}

// Signatures in codex output that mean "no usable ChatGPT session". Matched
// case-insensitively against a bounded, already-safe tail of stderr/stdout.
const NOT_LOGGED_IN_PATTERNS = [
  /not logged in/i,
  /run\s+`?codex login`?/i,
  /please (?:sign in|log in|login)/i,
  /unauthenti/i,
  /unauthori[sz]ed/i,
  /session (?:expired|invalid)/i,
  /401/
];

export function looksLikeNotLoggedIn(text: string): boolean {
  return NOT_LOGGED_IN_PATTERNS.some((re) => re.test(text));
}
