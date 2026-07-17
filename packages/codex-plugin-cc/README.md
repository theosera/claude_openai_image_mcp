# codex-plugin-cc

A **detachable image-provider plugin** for the parent
[`claude-openai-image-mcp`](../../README.md) server. It generates images through
the **OpenAI Codex CLI's built-in image tool**, which authenticates with your
**ChatGPT subscription** — so image generation runs within your subscription's
usage limits, with **no `OPENAI_API_KEY`** and no per-image API billing.

This package lives in the host repo for convenience but is **not part of the
core**: the core never imports it or lists it as a dependency. A dedicated CI
job builds, audits, and tests this package independently. Activation is opt-in
and removable (two env vars). It is the "subscription lane" the host's plugin
seam was designed for; the host's primary lane stays API-key billing
(`gpt-image-2` via the official SDK).

## How it works

`generate()` runs `codex exec` non-interactively, instructing Codex's image tool
to save one image into a per-request scratch directory, then reads the file back
as base64 and returns it as MCP image content.

```text
host (claude-openai-image-mcp)
  └─ providerGuard  (timeout · base64/MIME/size validation · redaction)
       └─ codex-plugin-cc.generate()
            └─ codex exec …  →  ChatGPT subscription  →  gpt-image-2  →  file
```

The host wraps every result in its own `providerGuard`, so this plugin only owns
the Codex call. What the plugin adds on top of that:

- **stdio-safe child process** — Codex is spawned with piped stdio (never
  inherited), so it can't corrupt the host's MCP stdout stream.
- **abort-safe** — on the host's timeout/cancel signal, the whole Codex process
  group is `SIGTERM`'d then `SIGKILL`'d (no zombie Codex holding your session).
- **isolated automation** — Codex runs in an ephemeral workspace-write sandbox,
  ignores user config, and receives an allowlisted environment containing no API
  keys, access tokens, or unrelated host secrets.
- **subscription-only auth gate** — every request checks `codex login status`
  and accepts only _Logged in using ChatGPT_. Missing/expired auth maps to
  `codex_not_logged_in`; persisted API-key auth maps to `codex_wrong_auth` before
  `codex exec` can run.
- **honest image metadata** — MIME is detected from the file bytes, so a PNG
  written for a WebP request is safely returned as PNG rather than mislabeled.
- **honest model reporting** — the reported `model` is an advisory label; the
  subscription lane's real model is backend-decided and **not client-pinnable**.

## Prerequisites

- Node ≥ 22.12
- The **Codex CLI**, logged in to your ChatGPT account: `codex login`
  (verify with `codex login status` → _Logged in using ChatGPT_)
- A ChatGPT plan whose usage covers Codex image generation

## Build & test

This package is standalone: the parent core is a **dev-only** `file:../..`
dependency (contract types + contract tests), never a runtime dependency. Build
the core once, then this package:

```bash
# from the repo root: build the core so the contract tests can load it
pnpm install && pnpm run build

# then this package
cd packages/codex-plugin-cc
pnpm install
pnpm run build
pnpm test        # unit + contract tests against a fake codex (no network/login/billing)
```

## Use it from the host

Point the host at this plugin with its two opt-in env vars (both required):

```bash
IMAGE_MCP_PROVIDER=plugin
IMAGE_MCP_PROVIDER_MODULE=/absolute/path/to/repo/packages/codex-plugin-cc/dist/index.js
```

Register the host as an MCP server as usual. Detaching the lane is removing
those two env vars — the core has no build-time dependency on this package, and
there is **no automatic fallback** between lanes.

## Configuration

All via environment variables (see [`.env.example`](.env.example)):

| Variable                   | Default                                                                                               | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `CODEX_PLUGIN_COMMAND`     | `codex`                                                                                               | Codex executable (must use ChatGPT login)                   |
| `CODEX_PLUGIN_ARGS`        | `["exec","--sandbox","workspace-write","--ephemeral","--ignore-user-config","--skip-git-repo-check"]` | Base args before the prompt (JSON array or space-separated) |
| `CODEX_PLUGIN_TMPDIR`      | OS temp dir                                                                                           | Parent of per-request scratch dirs                          |
| `CODEX_PLUGIN_MODEL_LABEL` | advisory codex label                                                                                  | Label reported as the result `model`                        |

> **Integration note.** The exact `codex exec` flags and how a given Codex
> version saves images can change; `CODEX_PLUGIN_ARGS` exists so you can adapt
> without code changes. The tests drive a **fake `codex`** so the orchestration
> (spawn, abort, exit handling, file read-back) is verified without network,
> login, or billing; confirm the real command against your Codex version before
> relying on it.

`CODEX_PLUGIN_ARGS` is a security boundary. If you override it, retain an
ephemeral session, an explicit workspace-write sandbox, and isolation from
unrelated user configuration unless an equivalently isolated `CODEX_HOME` is
provided.

## Trust & scope

This plugin runs **in-process with the host's full privileges** (trusted code by
the host's contract — the version handshake is a compatibility gate, not a
sandbox). Its child Codex process is narrowed by sandbox, config isolation, and
an environment allowlist, but still uses your local ChatGPT-authenticated Codex
installation. The subscription-driven image path is **unofficial** and may
change or break as OpenAI evolves Codex; that is exactly why it is an opt-in,
removable plugin rather than part of the host core.

## License

[MIT](./LICENSE)
