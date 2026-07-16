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
   * ["exec", "--full-auto", "--skip-git-repo-check"]. `codex exec` is the
   * non-interactive entrypoint; --full-auto lets it write the image file without
   * an approval prompt; --skip-git-repo-check is REQUIRED here because we run
   * codex from a fresh temp scratch dir (not a git repo) and codex exec
   * otherwise refuses to run outside a repository. Override per your codex
   * version if needed.
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
  /** If true, run `codex login status` once before the first generation. Default false. */
  preflightLogin: boolean;
  /** Grace period (ms) between SIGTERM and SIGKILL when the host aborts. Default 2000. */
  killGraceMs: number;
  /**
   * Max bytes read from codex's scratch output before base64 encoding. Bounds
   * plugin memory ahead of the host guard (which only sees the result after we
   * return). Threaded from the host's IMAGE_MCP_MAX_IMAGE_BYTES.
   */
  maxImageBytes: number;
}

// API-key auth vars codex honors, matched case-insensitively. Stripped so the
// subscription lane can never silently fall back to per-image API billing:
// OPENAI_API_KEY (SDK-style) and CODEX_API_KEY (codex exec's own API-key var).
const API_KEY_ENV_NAMES = new Set(["OPENAI_API_KEY", "CODEX_API_KEY"]);

const DEFAULT_MAX_IMAGE_BYTES = 15_728_640; // 15 MiB — matches the host default.

/**
 * Env handed to EVERY codex child, with every API-key auth var stripped
 * (case-insensitively, since env lookup is case-insensitive on Windows). This
 * lane promises ChatGPT-subscription usage only; leaving a key in the child's
 * env would let codex authenticate by API key and bill per image.
 */
export function codexChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clone = { ...env };
  for (const key of Object.keys(clone)) {
    if (API_KEY_ENV_NAMES.has(key.toUpperCase())) {
      delete clone[key];
    }
  }
  return clone;
}

function splitArgs(raw: string | undefined, fallback: string[]): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  // Accept a JSON array (["exec","--full-auto"]) or a plain space-separated string.
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
    baseArgs: splitArgs(env.CODEX_PLUGIN_ARGS, ["exec", "--full-auto", "--skip-git-repo-check"]),
    tmpDir: env.CODEX_PLUGIN_TMPDIR?.trim() || os.tmpdir(),
    modelLabel:
      env.CODEX_PLUGIN_MODEL_LABEL?.trim() ||
      `gpt-image-2 (codex subscription; backend-decided, advisory host=${hostModel})`,
    preflightLogin: /^(1|true|yes)$/i.test(env.CODEX_PLUGIN_PREFLIGHT_LOGIN?.trim() ?? ""),
    killGraceMs: 2000,
    maxImageBytes
  };
}
