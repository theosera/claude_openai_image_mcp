import process from "node:process";
import { type ImageProviderLike, createCodexImageProvider } from "./codexProvider.js";
import { loadCodexConfig } from "./config.js";

/**
 * codex-plugin-cc — a detachable image provider plugin for
 * claude-openai-image-mcp. It generates images through the OpenAI Codex CLI's
 * built-in image tool, which authenticates with the user's ChatGPT
 * subscription (no OPENAI_API_KEY, no per-image API billing).
 *
 * This module implements the host's plugin contract
 * (`claude-openai-image-mcp/provider`): it exports `providerApiVersion` and
 * `createImageProvider`. The host loads it ONLY when both
 * IMAGE_MCP_PROVIDER=plugin and IMAGE_MCP_PROVIDER_MODULE point here, and wraps
 * every result in its own providerGuard (timeout, base64/MIME/size validation,
 * identity pinning, redaction). Detaching the lane is removing those two env
 * vars — the host has no build-time dependency on this package.
 */

// MUST equal the host's PROVIDER_API_VERSION. The host refuses to start on a
// mismatch (fail-closed), so bump this only in lockstep with the contract.
export const providerApiVersion = 1;

/** Factory called by the host's loader. `ctx.model` is advisory for this lane. */
export function createImageProvider(ctx: { model: string; limits?: { maxImageBytes?: number } }): ImageProviderLike {
  const config = loadCodexConfig(ctx.model, process.env, ctx.limits?.maxImageBytes);
  return createCodexImageProvider(config);
}
