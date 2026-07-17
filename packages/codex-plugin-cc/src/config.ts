import os from "node:os";
import process from "node:process";

/**
 * Resolved, secret-free configuration for the codex lane. NOTE: this plugin
 * needs NO OPENAI_API_KEY — it drives the OpenAI Codex CLI, which authenticates
 * with the user's ChatGPT subscription. Keep API keys out of this process.
 */
export interface CodexConfig {
  /** Executable to run. Default "codex". */
  command: string;
  /**
   * Base args before the prompt. Default
   * ["exec", "--sandbox", "workspace-write", "--ephemeral",
   * "--ignore-user-config", "--skip-git-repo-check"]. `codex exec` is the
   * non-interactive entrypoint. The explicit sandbox permits writing only in the
   * fresh scratch workspace; ephemeral mode avoids persisting prompts/session
   * rollouts; ignoring user config prevents unrelated configured MCP servers or
   * automation settings from entering this provider boundary. The git-repo
   * check must be skipped because the scratch directory is intentionally not a
   * repository. Override per your Codex version if needed.
   */
  baseArgs: string[];
  /** Directory under which each request gets a fresh scratch subdir. Default os.tmpdir(). */
  tmpDir: string;
  /**
   * Advisory model label reported in results. The subscription/OAuth lane's
   * real model is chosen by the Codex backend (currently gpt-image-2) and is
   * NOT client-pinnable, so this is descriptive, not authoritative.
   */
  modelLabel: string;
  /** Grace period (ms) between SIGTERM and SIGKILL when the host aborts. Default 2000. */
  killGraceMs: number;
  /**
   * Max bytes read from codex's scratch output before base64 encoding. Bounds
   * plugin memory ahead of the host guard (which only sees the result after we
   * return). Threaded from the host's IMAGE_MCP_MAX_IMAGE_BYTES.
   */
  maxImageBytes: number;
}

// Pass only process/runtime state that Codex needs to locate its executable,
// persisted ChatGPT login, temporary directory, locale, and TLS roots. In
// particular, do not pass arbitrary host secrets or any token/key variables to
// the general-purpose child agent. Match case-insensitively for Windows.
const CHILD_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "CODEX_HOME",
  "CODEX_SQLITE_HOME",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA"
]);

const DEFAULT_MAX_IMAGE_BYTES = 15_728_640; // 15 MiB — matches the host default.

/**
 * Minimal env handed to EVERY Codex child. Authentication comes from Codex's
 * persisted ChatGPT session under CODEX_HOME/HOME; direct API keys, access
 * tokens, provider credentials, and unrelated host secrets are never inherited.
 */
export function codexChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && CHILD_ENV_ALLOWLIST.has(key.toUpperCase())) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}

function splitArgs(raw: string | undefined, fallback: string[]): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  // Accept a JSON array (["exec","--ephemeral"]) or a plain space-separated string.
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed;
      }
    } catch {
      // fall through to whitespace split
    }
  }
  return trimmed.split(/\s+/);
}

/**
 * Build config from env. `hostModel` is the host-advertised model (advisory
 * here); `hostMaxImageBytes` is the host's decoded-image limit (threaded from
 * the plugin factory's ctx.limits). CODEX_PLUGIN_MODEL_LABEL overrides the
 * reported label; CODEX_PLUGIN_MAX_IMAGE_BYTES overrides the size cap.
 */
export function loadCodexConfig(
  hostModel: string,
  env: NodeJS.ProcessEnv = process.env,
  hostMaxImageBytes: number = DEFAULT_MAX_IMAGE_BYTES
): CodexConfig {
  const envCap = Number.parseInt(env.CODEX_PLUGIN_MAX_IMAGE_BYTES?.trim() ?? "", 10);
  const maxImageBytes = Number.isInteger(envCap) && envCap > 0 ? envCap : hostMaxImageBytes;
  return {
    command: env.CODEX_PLUGIN_COMMAND?.trim() || "codex",
    baseArgs: splitArgs(env.CODEX_PLUGIN_ARGS, [
      "exec",
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check"
    ]),
    tmpDir: env.CODEX_PLUGIN_TMPDIR?.trim() || os.tmpdir(),
    modelLabel:
      env.CODEX_PLUGIN_MODEL_LABEL?.trim() ||
      `gpt-image-2 (codex subscription; backend-decided, advisory host=${hostModel})`,
    killGraceMs: 2000,
    maxImageBytes
  };
}
