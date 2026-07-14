# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repository's **Security** tab). Do not open a
public issue for a security report.

## Threat model & guarantees

This is a **local, single-user** MCP server that generates images through the
OpenAI Images API. It is designed to fail closed.

- **Server-side API key only.** The OpenAI API key is read from the environment
  (`OPENAI_API_KEY`) and never enters the loggable config object, never appears
  in tool output, and is never serialized. The default provider is `mock`, which
  needs no key and makes no network call.
- **Secret hygiene.** `.env` is git-ignored; only `.env.example` (empty values)
  is committed. The logger writes to **stderr only** and redacts anything shaped
  like an OpenAI key or a long base64 blob.
- **No prompt / image bytes in logs.** Only metadata (size, quality, format,
  duration, request id, provider) is logged — never the prompt text or the
  generated image bytes.
- **Allowlist enforcement.** `size`, `quality`, and `output_format` are validated
  against a server-side allowlist *before* any provider call. The model is chosen
  by the server; clients cannot pass a model name.
- **Bounded cost/latency.** Prompt length, timeout, retries, and concurrency are
  bounded via env (provisional defaults; see README).

## Out of scope (by design, this phase)

- No live OpenAI billing path is enabled by default (mock provider).
- No remote transport / OAuth yet (planned; the OpenAI key is never exposed to
  clients under any transport).

## Supported versions

Pre-1.0: only the latest `main` is supported.
