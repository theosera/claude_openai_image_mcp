import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatForMimeType, type AppConfig } from "./config.js";
import { toSafeMessage, validationError } from "./errors.js";
import type { ImageProvider } from "./imageProvider.js";
import { log } from "./logging.js";

// Advertise the package version as the MCP server version (single source of
// truth). `../package.json` resolves from both dist/server.js and src/server.ts.
const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json") as { version: string };

export const SERVER_INSTRUCTIONS =
  "Use this server to generate an image with OpenAI's image model and receive it as MCP image content. " +
  "Call generate_image with a text prompt; optionally set size, quality, and output_format (each restricted to a server-side allowlist). " +
  "The server chooses the model — clients never pass a model name. " +
  "The result metadata distinguishes the requested output format from the actual returned image format. " +
  "The prompt is sent to the configured provider; with the openai or plugin provider it leaves this machine, so do not include secrets in prompts.";

export interface BuildServerOptions {
  config: AppConfig;
  provider: ImageProvider;
}

/**
 * Build the McpServer exposing the single `generate_image` tool. Validation and
 * allowlist enforcement happen HERE (before the provider is called), so an
 * out-of-allowlist request never reaches the upstream API.
 */
export function buildMcpServer(options: BuildServerOptions): McpServer {
  const { config, provider } = options;
  const { allowed, defaults, limits } = config;

  const server = new McpServer(
    { name: "claude-openai-image-mcp", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // In-flight gate: honor IMAGE_MCP_MAX_CONCURRENCY so a burst cannot fan out
  // unbounded upstream calls (and cost) once the live provider is wired.
  let inFlight = 0;

  server.registerTool(
    "generate_image",
    {
      title: "Generate an image",
      description:
        "Generate an image from a text prompt using the configured OpenAI image model. " +
        "Returns an image (base64) plus metadata including requested and actual formats. size/quality/output_format are optional and " +
        "restricted to the server allowlist; the server picks the model.",
      inputSchema: {
        prompt: z.string().min(1).max(limits.maxPromptChars),
        size: z.string().optional(),
        quality: z.string().optional(),
        output_format: z.string().optional()
      },
      outputSchema: {
        provider: z.enum(["mock", "openai", "plugin"]),
        model: z.string(),
        size: z.string(),
        quality: z.string(),
        requested_output_format: z.enum(["png", "webp", "jpeg"]),
        output_format: z.enum(["png", "webp", "jpeg"]),
        request_id: z.string()
      },
      // Not read-only (it calls an external model), but non-destructive and open-world.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async (input, extra) => {
      const size = input.size ?? defaults.size;
      const quality = input.quality ?? defaults.quality;
      const format = input.output_format ?? defaults.format;

      try {
        if (!allowed.sizes.includes(size)) {
          throw validationError(`size "${size}" is not allowed. Allowed: ${allowed.sizes.join(", ")}.`);
        }
        if (!allowed.qualities.includes(quality)) {
          throw validationError(`quality "${quality}" is not allowed. Allowed: ${allowed.qualities.join(", ")}.`);
        }
        if (!allowed.formats.includes(format)) {
          throw validationError(`output_format "${format}" is not allowed. Allowed: ${allowed.formats.join(", ")}.`);
        }

        if (inFlight >= limits.maxConcurrency) {
          throw validationError(`Server busy: max ${limits.maxConcurrency} concurrent generation(s). Retry shortly.`);
        }

        inFlight += 1;
        const started = Date.now();
        try {
          const result = await provider.generate({ prompt: input.prompt, size, quality, format, signal: extra.signal });
          const actualFormat = formatForMimeType(result.mimeType);
          // Metadata only — never the prompt text or the image bytes.
          log.info("generate_image.ok", {
            provider: result.provider,
            model: result.model,
            size,
            quality,
            requested_output_format: format,
            output_format: actualFormat,
            request_id: result.requestId,
            duration_ms: Date.now() - started
          });

          return {
            content: [
              {
                type: "image" as const,
                data: result.base64,
                mimeType: result.mimeType
              }
            ],
            structuredContent: {
              provider: result.provider,
              model: result.model,
              size,
              quality,
              requested_output_format: format,
              output_format: actualFormat,
              request_id: result.requestId
            }
          };
        } finally {
          inFlight -= 1;
        }
      } catch (err) {
        const message = toSafeMessage(err);
        log.warn("generate_image.error", { size, quality, output_format: format, message });
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true
        };
      }
    }
  );

  return server;
}
