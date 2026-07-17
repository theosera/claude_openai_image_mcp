import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { type CodexConfig, codexChildEnv } from "./config.js";
import { CodexError, looksLikeNotLoggedIn } from "./errors.js";

// Cap captured output so a chatty codex run can't balloon memory. We only ever
// need a tail for diagnostics; the image itself is written to a file, not stdout.
const MAX_CAPTURE_BYTES = 64 * 1024;
const DIAG_TAIL_CHARS = 400;

export interface RunCodexOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Host-provided abort signal (providerGuard fires this on timeout/cancel). */
  signal?: AbortSignal;
  killGraceMs: number;
  env: NodeJS.ProcessEnv;
}

export interface RunCodexResult {
  stdout: string;
  stderr: string;
}

// Keep the most RECENT MAX_CAPTURE_BYTES: auth failures and the useful
// diagnostic tail are emitted at the END of a run, so a sliding window that
// retains the head would drop exactly what looksLikeNotLoggedIn()/tail() need.
function appendCapped(buf: string, chunk: Buffer): string {
  const combined = buf + chunk.toString("utf8");
  return combined.length > MAX_CAPTURE_BYTES ? combined.slice(-MAX_CAPTURE_BYTES) : combined;
}

/** Best-effort kill of the whole process group (codex may spawn children). */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    // Negative pid targets the process group (child was spawned detached).
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Spawn `codex` non-interactively and wait for it to finish. Guarantees:
 *  - stdio is PIPED, never inherited (protects the host's MCP stdout on stdio);
 *  - on abort, the whole process group is SIGTERM'd then SIGKILL'd after a grace
 *    period (no zombie codex holding the ChatGPT session);
 *  - a missing binary and a not-logged-in state map to distinct typed errors.
 */
export function runCodex(options: RunCodexOptions): Promise<RunCodexResult> {
  const { command, args, cwd, signal, killGraceMs, env } = options;

  return new Promise<RunCodexResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CodexError("codex_aborted", "Request aborted before codex started."));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        // No stdin, pipe out/err. detached so we can signal the whole group.
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
    } catch (err) {
      reject(new CodexError("codex_not_found", `Could not start "${command}": ${short(err)}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = (): void => {
      if (settled) {
        return;
      }
      killTree(child, "SIGTERM");
      killTimer = setTimeout(() => killTree(child, "SIGKILL"), killGraceMs);
      // Do not settle here; wait for "close" so the SIGKILL path is honored.
    };

    child.stdout?.on("data", (c: Buffer) => {
      stdout = appendCapped(stdout, c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr = appendCapped(stderr, c);
    });

    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      // ENOENT here means the binary was not found.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new CodexError("codex_not_found", `codex binary "${command}" not found on PATH.`));
      } else {
        reject(new CodexError("codex_failed", `codex process error: ${short(err)}`));
      }
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (signal?.aborted) {
        reject(new CodexError("codex_aborted", "codex was aborted by the host (timeout or cancellation)."));
        return;
      }
      const combined = `${stdout}\n${stderr}`;
      if (looksLikeNotLoggedIn(combined)) {
        reject(
          new CodexError(
            "codex_not_logged_in",
            "codex has no ChatGPT session. Run `codex login` (subscription lane needs an interactive login)."
          )
        );
        return;
      }
      if (code !== 0) {
        reject(new CodexError("codex_failed", `codex exited with code ${code ?? "null"}. ${tail(stderr)}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `codex login status` and fail closed unless the active authentication
 * method is explicitly ChatGPT. Removing API-key environment variables is not
 * sufficient because `codex login --with-api-key` persists credentials under
 * CODEX_HOME; the status output is the authoritative billing-lane check.
 */
export function checkCodexLogin(config: CodexConfig, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CodexError("codex_aborted", "Request aborted before codex login check."));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(config.command, ["login", "status"], {
        // Same API-key stripping as generation: the login check must not be
        // able to authenticate (or report authed) via a leftover API key.
        env: codexChildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
    } catch (err) {
      reject(new CodexError("codex_not_found", `Could not start "${config.command}": ${short(err)}`));
      return;
    }

    let out = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      killTree(child, "SIGTERM");
      killTimer = setTimeout(() => killTree(child, "SIGKILL"), config.killGraceMs);
    };

    child.stdout?.on("data", (c: Buffer) => {
      out = appendCapped(out, c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      out = appendCapped(out, c);
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const code = (err as NodeJS.ErrnoException).code;
      reject(
        code === "ENOENT"
          ? new CodexError("codex_not_found", `codex binary "${config.command}" not found on PATH.`)
          : new CodexError("codex_failed", `codex login check error: ${short(err)}`)
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (signal?.aborted) {
        reject(new CodexError("codex_aborted", "codex login check was aborted by the host."));
        return;
      }
      // Accept only the subscription lane. Deliberately reject generic
      // "logged in" and API-key/access-token methods.
      if (code === 0 && /logged in using chatgpt/i.test(out) && !looksLikeNotLoggedIn(out)) {
        resolve();
      } else if (code === 0 && /logged in/i.test(out)) {
        reject(
          new CodexError(
            "codex_wrong_auth",
            "codex-plugin-cc requires ChatGPT authentication, but Codex is logged in using another method. Run `codex logout`, then `codex login`, and verify `codex login status` says Logged in using ChatGPT."
          )
        );
      } else {
        reject(
          new CodexError(
            "codex_not_logged_in",
            "codex has no ChatGPT session. Run `codex login` before using the subscription lane."
          )
        );
      }
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, DIAG_TAIL_CHARS);
}

/** Last chars of codex stderr for diagnostics (host guard redacts further). */
function tail(text: string): string {
  const t = text.trim();
  if (!t) {
    return "";
  }
  return t.length > DIAG_TAIL_CHARS ? `…${t.slice(-DIAG_TAIL_CHARS)}` : t;
}
