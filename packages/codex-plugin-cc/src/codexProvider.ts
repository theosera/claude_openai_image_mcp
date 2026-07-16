import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { type CodexConfig, codexChildEnv } from "./config.js";
import { checkCodexLogin, runCodex } from "./codex.js";
import { CodexError } from "./errors.js";

// The provider returns objects matching the host's GenerateResult shape. We
// avoid a hard runtime import of the host package (this plugin has zero runtime
// deps); the host's providerGuard validates every field we return anyway.
export interface GenerateInputLike {
  prompt: string;
  size: string;
  quality: string;
  format: string;
  signal?: AbortSignal;
}
export interface GenerateResultLike {
  base64: string;
  mimeType: string;
  model: string;
  provider: "plugin";
  requestId: string;
}
export interface ImageProviderLike {
  readonly kind: "plugin";
  generate(input: GenerateInputLike): Promise<GenerateResultLike>;
}

const EXT: Record<string, string> = { png: "png", webp: "webp", jpeg: "jpg" };
const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg" };

function buildPrompt(input: GenerateInputLike, filename: string): string {
  // Instruct codex's built-in image tool to save one file into the cwd. Kept
  // terse and imperative so the agent doesn't chat instead of producing a file.
  return (
    `${input.prompt}\n\n` +
    `Task: generate exactly one image and save it as the file "${filename}" ` +
    `in the current working directory. Target size ${input.size}, quality ${input.quality}, ` +
    `format ${input.format}. Do not print the image data or any commentary; only write the file.`
  );
}

class CodexImageProvider implements ImageProviderLike {
  readonly kind = "plugin" as const;

  #loginChecked = false;

  constructor(private readonly config: CodexConfig) {}

  async generate(input: GenerateInputLike): Promise<GenerateResultLike> {
    if (this.config.preflightLogin && !this.#loginChecked) {
      // Run once per provider instance; throws codex_not_logged_in if no session.
      await checkCodexLogin(this.config, input.signal);
      this.#loginChecked = true;
    }

    const ext = EXT[input.format] ?? "png";
    const mimeType = MIME[input.format] ?? "image/png";
    const filename = `image.${ext}`;

    // Fresh, isolated scratch dir per request; codex runs with this as cwd.
    const scratchDir = await mkdtemp(join(this.config.tmpDir, "codex-img-"));
    try {
      await runCodex({
        command: this.config.command,
        args: [...this.config.baseArgs, buildPrompt(input, filename)],
        cwd: scratchDir,
        signal: input.signal,
        killGraceMs: this.config.killGraceMs,
        env: codexChildEnv()
      });

      const bytes = await this.#readImage(join(scratchDir, filename), filename);

      return {
        base64: bytes.toString("base64"),
        mimeType,
        model: this.config.modelLabel,
        provider: "plugin",
        requestId: `codex-${randomUUID()}`
      };
    } finally {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Read codex's scratch output as UNTRUSTED data: refuse to follow a symlink
   * (O_NOFOLLOW), require a regular file, and cap the size BEFORE reading so a
   * huge or hostile file can't OOM the plugin ahead of the host guard.
   */
  async #readImage(filePath: string, filename: string): Promise<Buffer> {
    let handle;
    try {
      // O_NOFOLLOW: opening a symlink at the final component fails (ELOOP).
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch {
      throw new CodexError(
        "codex_no_image",
        `codex finished but did not write a regular file "${filename}". The prompt may have been refused, the file may be a symlink, or this codex version saves elsewhere.`
      );
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new CodexError("codex_no_image", `codex output "${filename}" is not a regular file.`);
      }
      if (stat.size > this.config.maxImageBytes) {
        throw new CodexError(
          "codex_no_image",
          `codex output is ${stat.size} bytes; exceeds the ${this.config.maxImageBytes}-byte cap (IMAGE_MCP_MAX_IMAGE_BYTES).`
        );
      }
      // Regular file within the cap: read exactly its bytes.
      return await handle.readFile();
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

export function createCodexImageProvider(config: CodexConfig): ImageProviderLike {
  return new CodexImageProvider(config);
}
