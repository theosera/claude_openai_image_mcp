# claude-openai-image-mcp

A small, security-first [MCP](https://modelcontextprotocol.io) server that
generates images with OpenAI's image model (`gpt-image-2`) and returns them as
MCP **image content** — usable from Claude Code (CLI), Claude Desktop, and other
stdio MCP clients.

The OpenAI API key is held **server-side only**. The default provider is a
**mock** that returns a real 1×1 PNG with no network call and no billing, so you
can wire up and test the whole flow before spending a cent.

> Status: **Phase 1** — repo scaffold, `generate_image` tool, mock provider, CI.
> The live OpenAI call is a documented skeleton (`src/openaiImageClient.ts`) that
> fails closed until Phase 2. See [Roadmap](#roadmap).

## Tool

### `generate_image`

| Field           | Type   | Required | Notes                                                        |
| --------------- | ------ | -------- | ------------------------------------------------------------ |
| `prompt`        | string | yes      | 1..`IMAGE_MCP_MAX_PROMPT_CHARS` chars                        |
| `size`          | string | no       | must be in `IMAGE_MCP_ALLOWED_SIZES` (default `1024x1024`)   |
| `quality`       | string | no       | must be in `IMAGE_MCP_ALLOWED_QUALITIES` (default `low`)     |
| `output_format` | string | no       | must be in `IMAGE_MCP_ALLOWED_FORMATS` (default `png`)       |

The **server** chooses the model; clients never pass a model name. Requests
outside the allowlist are rejected *before* any provider call.

Returns MCP image content `{ type: "image", data: <base64>, mimeType }` plus
`structuredContent` with `{ provider, model, size, quality, output_format, request_id }`.

## Quick start

Requires Node ≥ 22.12 and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env        # defaults to the mock provider (no key needed)
pnpm run build
pnpm test
```

Run the server over stdio:

```bash
pnpm run dev                # tsx src/index.ts
# or, after build:
node dist/index.js
```

### Register with Claude Code

```bash
claude mcp add openai-image -- node /absolute/path/to/dist/index.js
```

(For the mock provider no `OPENAI_API_KEY` is needed. To use the real API later,
set `IMAGE_MCP_PROVIDER=openai` and `OPENAI_API_KEY` in the server's environment.)

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)).
`.env` is git-ignored — **never commit real secrets**.

| Variable                     | Default                              | Purpose                                            |
| ---------------------------- | ------------------------------------ | -------------------------------------------------- |
| `IMAGE_MCP_PROVIDER`         | `mock`                               | `mock` (offline) or `openai`                       |
| `OPENAI_API_KEY`             | —                                    | Required only when provider is `openai`            |
| `OPENAI_IMAGE_MODEL`         | `gpt-image-2`                        | Server-owned effective model                       |
| `IMAGE_MCP_MAX_PROMPT_CHARS` | `2000`                               | Reject longer prompts                              |
| `IMAGE_MCP_TIMEOUT_MS`       | `60000`                              | Per-request upstream timeout (Phase 2)             |
| `IMAGE_MCP_MAX_RETRIES`      | `0`                                  | Bounded transient retries (Phase 2)                |
| `IMAGE_MCP_MAX_CONCURRENCY`  | `1`                                  | Max concurrent generations                         |
| `IMAGE_MCP_ALLOWED_SIZES`    | `1024x1024,1536x1024,1024x1536`      | Allowlist                                          |
| `IMAGE_MCP_ALLOWED_QUALITIES`| `low,medium`                         | Allowlist                                          |
| `IMAGE_MCP_ALLOWED_FORMATS`  | `png,webp,jpeg`                      | Allowlist                                          |
| `IMAGE_MCP_DEFAULT_SIZE`     | first allowed size                   | Used when the client omits `size`                  |
| `IMAGE_MCP_DEFAULT_QUALITY`  | first allowed quality                | Used when the client omits `quality`               |
| `IMAGE_MCP_DEFAULT_FORMAT`   | first allowed format                 | Used when the client omits `output_format`         |

### Provisional values

`quality=low`, `concurrency=1`, `retries=0`, `n=1`, and `model=gpt-image-2` are
**provisional** — chosen to bound cost and latency and to be confirmed by
end-to-end evidence. Each carries a review condition in code comments; expect
them to change as we run real E2E tests.

## Security

The OpenAI key is server-side only and never logged, serialized, or returned.
Logs are stderr-only, metadata-only, and redacted. See [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm run lint:ox        # fast Rust correctness pass
pnpm run format:check   # prettier
pnpm run lint           # eslint
pnpm run typecheck      # tsc --noEmit
pnpm run build
pnpm test               # vitest (no network, no billing)
```

CI runs the same sequence (`.github/workflows/node.js.yml`) plus CodeQL.

## Roadmap

- **Phase 1 (this repo):** scaffold, `generate_image`, mock provider, CI. ✅
- **Phase 2:** wire `OpenAIImageProvider` to the official SDK (allowlist,
  timeout, bounded retry, 429/Retry-After/timeout/5xx mapping, byte/MIME checks);
  mock-reproduce every branch. Real API E2E only after explicit approval.
- **Phase 3:** Streamable HTTP transport + client→server OAuth (the OpenAI key is
  never forwarded to clients). Note: there is **no** official OpenAI OAuth path to
  call the Images API on a ChatGPT user's behalf — server-side API key only.

## License

[MIT](LICENSE)
