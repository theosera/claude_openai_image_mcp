import process from "node:process";
import dotenv from "dotenv";
import { configError } from "./errors.js";
import { type Limits, loadLimits } from "./limits.js";

// quiet: keep dotenv's banner off stderr — this process speaks MCP on stdio.
dotenv.config({ quiet: true });

// "plugin" is the detachable lane: an external, user-installed module loaded at
// runtime (never a build-time dependency), selected only by explicit env opt-in.
export type ProviderKind = "mock" | "openai" | "plugin";

export interface Allowlists {
  sizes: string[];
  qualities: string[];
  formats: string[];
}

export interface Defaults {
  size: string;
  quality: string;
  format: string;
}

/**
 * Fully-resolved, SECRET-FREE server config. The OpenAI API key is intentionally
 * NOT stored here: the provider factory reads it directly from env at
 * construction time, so this object stays safe to log/inspect.
 */
export interface AppConfig {
  provider: ProviderKind;
  /**
   * Effective model. Server-owned — clients never pass a model name. For the
   * plugin lane this is ADVISORY: the plugin's backend may pick its own model,
   * and results report what the plugin actually knows.
   */
  model: string;
  /** Module specifier of the provider plugin. Set iff provider is "plugin". */
  pluginModule?: string;
  limits: Limits;
  allowed: Allowlists;
  defaults: Defaults;
}

// Known-safe values for gpt-image models (2026-07). The allowlist is further
// narrowable via env, but never wider than what the API accepts.
const SUPPORTED_FORMATS = new Set(["png", "webp", "jpeg"]);
const SUPPORTED_QUALITIES = new Set(["auto", "high", "medium", "low"]);
// size uses "auto", the three standard sizes, or WIDTHxHEIGHT (each divisible by 16).
const SIZE_PATTERN = /^(auto|\d+x\d+)$/;

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseProvider(env: NodeJS.ProcessEnv): ProviderKind {
  const value = env.IMAGE_MCP_PROVIDER?.trim().toLowerCase() || "mock";
  if (value === "mock" || value === "openai" || value === "plugin") {
    return value;
  }
  throw configError(`Invalid IMAGE_MCP_PROVIDER="${env.IMAGE_MCP_PROVIDER}". Use "mock", "openai", or "plugin".`);
}

function parseAllowlists(env: NodeJS.ProcessEnv): Allowlists {
  const sizes = splitCsv(env.IMAGE_MCP_ALLOWED_SIZES) || [];
  const qualities = splitCsv(env.IMAGE_MCP_ALLOWED_QUALITIES);
  const formats = splitCsv(env.IMAGE_MCP_ALLOWED_FORMATS);

  const resolvedSizes = sizes.length > 0 ? sizes : ["1024x1024", "1536x1024", "1024x1536"];
  const resolvedQualities = qualities.length > 0 ? qualities : ["low", "medium"];
  const resolvedFormats = formats.length > 0 ? formats : ["png", "webp", "jpeg"];

  for (const size of resolvedSizes) {
    if (!SIZE_PATTERN.test(size)) {
      throw configError(`Invalid size "${size}" in IMAGE_MCP_ALLOWED_SIZES. Use "auto" or WIDTHxHEIGHT.`);
    }
  }
  for (const quality of resolvedQualities) {
    if (!SUPPORTED_QUALITIES.has(quality)) {
      throw configError(`Unsupported quality "${quality}" in IMAGE_MCP_ALLOWED_QUALITIES.`);
    }
  }
  for (const format of resolvedFormats) {
    if (!SUPPORTED_FORMATS.has(format)) {
      throw configError(`Unsupported format "${format}" in IMAGE_MCP_ALLOWED_FORMATS.`);
    }
  }

  return { sizes: resolvedSizes, qualities: resolvedQualities, formats: resolvedFormats };
}

function parseDefaults(env: NodeJS.ProcessEnv, allowed: Allowlists): Defaults {
  const size = env.IMAGE_MCP_DEFAULT_SIZE?.trim() || allowed.sizes[0];
  const quality = env.IMAGE_MCP_DEFAULT_QUALITY?.trim() || allowed.qualities[0];
  const format = env.IMAGE_MCP_DEFAULT_FORMAT?.trim() || allowed.formats[0];

  // A default MUST be inside its own allowlist, else a client omitting the field
  // would produce a request the allowlist would otherwise reject.
  if (!allowed.sizes.includes(size)) {
    throw configError(`IMAGE_MCP_DEFAULT_SIZE="${size}" is not in IMAGE_MCP_ALLOWED_SIZES.`);
  }
  if (!allowed.qualities.includes(quality)) {
    throw configError(`IMAGE_MCP_DEFAULT_QUALITY="${quality}" is not in IMAGE_MCP_ALLOWED_QUALITIES.`);
  }
  if (!allowed.formats.includes(format)) {
    throw configError(`IMAGE_MCP_DEFAULT_FORMAT="${format}" is not in IMAGE_MCP_ALLOWED_FORMATS.`);
  }

  return { size, quality, format };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = parseProvider(env);
  const model = env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const allowed = parseAllowlists(env);
  const defaults = parseDefaults(env, allowed);
  const limits = loadLimits(env);

  // Fail-closed: the plugin lane needs BOTH opt-ins (provider + module) before
  // the server will even start. Detaching = removing these two env vars.
  const pluginModule = env.IMAGE_MCP_PROVIDER_MODULE?.trim() || undefined;
  if (provider === "plugin" && !pluginModule) {
    throw configError(
      "IMAGE_MCP_PROVIDER=plugin requires IMAGE_MCP_PROVIDER_MODULE (module specifier or path of the provider plugin)."
    );
  }

  return { provider, model, pluginModule: provider === "plugin" ? pluginModule : undefined, limits, allowed, defaults };
}

/** Map an output_format to its MIME type for the MCP ImageContent block. */
export function mimeTypeForFormat(format: string): string {
  switch (format) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpeg":
      return "image/jpeg";
    default:
      throw configError(`No MIME type mapping for format "${format}".`);
  }
}

/** Map an actual MCP ImageContent MIME type back to its canonical format name. */
export function formatForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpeg";
    default:
      throw configError(`No output format mapping for MIME type "${mimeType}".`);
  }
}
