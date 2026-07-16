import path from "node:path";
import { pathToFileURL } from "node:url";
import { providerUnavailable } from "./errors.js";
import type { ImageProvider } from "./imageProvider.js";
import type { Limits } from "./limits.js";
import { redact } from "./logging.js";

// Single import surface for plugin authors (`claude-openai-image-mcp/provider`).
export type { GenerateInput, GenerateResult, ImageProvider } from "./imageProvider.js";
export type { Limits } from "./limits.js";

/**
 * Version handshake for external provider plugins (the detachable lane, e.g.
 * codex-plugin-cc). The core refuses to start on a mismatch, so a contract
 * change can never half-load an incompatible plugin. Bump on ANY breaking
 * change to GenerateInput/GenerateResult/ImageProvider/ProviderFactoryContext.
 */
export const PROVIDER_API_VERSION = 1;

export interface ProviderFactoryContext {
  /**
   * Server-configured model name. ADVISORY for plugins: a backend that picks
   * its own model (e.g. a subscription lane) may not honor it, and MUST report
   * the model it actually knows (or "unknown") in GenerateResult.model —
   * never echo this value back as if it were confirmed.
   */
  model: string;
  /**
   * Server limits. The guard enforces timeoutMs and maxImageBytes regardless,
   * but a well-behaved plugin should bound its own work too (and MUST abort
   * work / kill child processes when GenerateInput.signal fires).
   */
  limits: Limits;
}

/**
 * Shape a plugin module must export. Plugins run IN-PROCESS with the server's
 * full privileges — they are trusted code by definition (see SECURITY.md), so
 * this handshake is a compatibility gate, not a sandbox.
 */
export interface ProviderPluginModule {
  providerApiVersion: number;
  createImageProvider(ctx: ProviderFactoryContext): ImageProvider | Promise<ImageProvider>;
}

/** Normalize a load-time error into a short, redacted, secret-free string. */
function safeLoadMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redact(raw).slice(0, 200);
}

function assertPluginModule(mod: unknown, specifier: string): asserts mod is ProviderPluginModule {
  if (typeof mod !== "object" || mod === null) {
    throw providerUnavailable(`Provider plugin "${specifier}" did not evaluate to a module object.`);
  }
  const candidate = mod as Record<string, unknown>;
  if (typeof candidate.providerApiVersion !== "number") {
    throw providerUnavailable(`Provider plugin "${specifier}" does not export a numeric providerApiVersion.`);
  }
  if (candidate.providerApiVersion !== PROVIDER_API_VERSION) {
    throw providerUnavailable(
      `Provider plugin "${specifier}" targets provider API version ${candidate.providerApiVersion}, ` +
        `but this server requires ${PROVIDER_API_VERSION}. Refusing to start.`
    );
  }
  if (typeof candidate.createImageProvider !== "function") {
    throw providerUnavailable(`Provider plugin "${specifier}" does not export createImageProvider().`);
  }
}

/**
 * Dynamically load a provider plugin. FAIL-CLOSED: any resolution, import,
 * handshake, or factory failure aborts startup with a secret-free error.
 * The specifier may be a bare npm package name or a filesystem path.
 */
export async function loadPluginProvider(specifier: string, ctx: ProviderFactoryContext): Promise<ImageProvider> {
  const resolved =
    specifier.startsWith(".") || path.isAbsolute(specifier) ? pathToFileURL(path.resolve(specifier)).href : specifier;

  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ resolved);
  } catch (err) {
    throw providerUnavailable(`Failed to load provider plugin "${specifier}": ${safeLoadMessage(err)}`);
  }

  assertPluginModule(mod, specifier);

  let provider: ImageProvider;
  try {
    provider = await mod.createImageProvider(ctx);
  } catch (err) {
    throw providerUnavailable(`Provider plugin "${specifier}" factory failed: ${safeLoadMessage(err)}`);
  }

  if (typeof provider !== "object" || provider === null || typeof provider.generate !== "function") {
    throw providerUnavailable(`Provider plugin "${specifier}" returned an object that is not an ImageProvider.`);
  }
  // A plugin must identify as "plugin" — it may not impersonate the built-in
  // mock/openai lanes in logs and structuredContent.
  if (provider.kind !== "plugin") {
    throw providerUnavailable(`Provider plugin "${specifier}" must declare kind "plugin", got "${provider.kind}".`);
  }
  return provider;
}
