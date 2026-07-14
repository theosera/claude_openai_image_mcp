# CLAUDE.md — claude_openai_image_mcp

Local MCP server that generates images via the OpenAI Images API (`gpt-image-2`)
and returns them as MCP image content. Server-side API key only; mock provider by
default (no network, no billing).

## Stack & commands

- TypeScript, ESM, Node ≥ 22.12, pnpm. MCP: `@modelcontextprotocol/sdk`. Validation: `zod`.
- `pnpm run dev` (tsx) · `pnpm run build` · `pnpm test` (vitest) ·
  `pnpm run lint:ox` · `pnpm run format:check` · `pnpm run lint` · `pnpm run typecheck`
- CI mirrors this order in `.github/workflows/node.js.yml` (+ CodeQL). Keep it green.

## Architecture

- `src/config.ts` — secret-free `AppConfig` (provider, model, allowlists, defaults). Fail-closed.
- `src/limits.ts` — numeric bounds (prompt length, timeout, retries, concurrency).
- `src/imageProvider.ts` — `ImageProvider` interface, `MockImageProvider`, `createProvider` factory.
- `src/openaiImageClient.ts` — Phase 2 skeleton; **not wired**, fails closed.
- `src/server.ts` — `buildMcpServer` + the single `generate_image` tool (validation/allowlist here).
- `src/index.ts` — stdio entrypoint. `src/logging.ts` — stderr-only, redacting logger.

## Invariants (do not break)

- **API key is server-side only.** Never put it in `AppConfig`, logs, tool output, or JSON.stringify.
- **Allowlist before provider call.** Validate `size`/`quality`/`output_format` up front; server picks the model.
- **Logs = metadata only.** No prompt text, no image base64. The logger redacts key/base64 as defense in depth.
- **Mock stays the default.** No live OpenAI call / billing without explicit user approval.
- `.env` and generated images are git-ignored. Only `.env.example` (empty values) is committed.

## Provisional values

`quality=low`, `concurrency=1`, `retries=0`, `n=1`, `model=gpt-image-2` are provisional; each has a
review condition in code comments. Confirm via E2E before hardening.

## Working agreements

- This is a **public** repo reviewed by CodeRabbit + Codex on PRs. Keep PRs single-purpose.
- External actions (GitHub repo creation, `git push`, publishing) require explicit approval first.
- Skill firing: for MCP setup / transport / auth / OAuth / E2E re-verification, load the
  `configure-mcp-foundation` skill (separate/immutable-contract vs variable-config split) before acting.
