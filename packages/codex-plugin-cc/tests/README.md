# codex-plugin-cc — conformance, real-codex E2E, and record/replay

This directory is the **starter kit for closing the Codex-review findings**. Its
purpose is to add the one thing the original implementation lacked: *ground
truth*. The original fixtures encoded the author's assumptions (a fake codex
that prints "Logged in using ChatGPT" and writes a PNG), so tests passed by
construction and never challenged those assumptions. These artifacts make the
contract verifiable instead.

## 1. Conformance specs — the definition of done (`conformance.test.ts`)

Each Codex finding is an executable spec. Unfixed ones are `it.skip` / `it.todo`
with the exact expected behavior — flip them to active as each fix lands.

| Finding | Spec | State | Fix location |
| --- | --- | --- | --- |
| **P1-1** subscription-only auth | rejects API-key/stored auth (only ChatGPT) | `skip` + `todo` | `src/codex.ts` (auth-method check), default preflight |
| **P1-2** MCP cancel reaches codex | client cancel kills codex before guard timeout | `todo` | `src/server.ts` (thread `extra.signal`) + `src/providerGuard.ts` (`AbortSignal.any`) |
| **P1-3** child isolation | ephemeral / ignore-user-config / explicit sandbox; drop `--full-auto` | `todo` | `src/config.ts` default `baseArgs` (confirm flags from `codex exec --help`) |
| **P2-4** MIME == actual bytes | reject non-PNG the lane can't guarantee (or detect real format) | `skip` | `src/codexProvider.ts` |
| **P2-5** package runs in CI | build+typecheck+test entrypoint | ✅ active | `.github/workflows/codex-plugin.yml` |

Run: `pnpm test` (skipped/todo entries show as the remaining acceptance
criteria).

## 2. Real-codex E2E — the ground truth (`real-codex.e2e.test.ts`)

Opt-in only (`CODEX_E2E=1`); never runs in CI (needs `codex login` + consumes
ChatGPT-subscription quota). This exercises the plugin↔real-codex boundary that
P1-1 / P1-3 / P2-4 live on — the boundary fakes can only assume.

```bash
codex login                      # ChatGPT subscription
pnpm run build
CODEX_E2E=1 pnpm test real-codex
```

## 3. Record / replay harness — observation-derived fakes (`harness/`)

Instead of hand-writing a fake codex from assumptions, **record real codex once
and replay the transcript** in CI (no billing, no login on CI):

```bash
# record real codex → a transcript (local, logged in; consumes quota)
node tests/harness/record.mjs > tests/harness/transcripts/chatgpt-success.json

# replay it as the fake codex in a test / manual run
CODEX_PLUGIN_COMMAND="$(pwd)/tests/harness/transcript-codex.mjs" \
CODEX_TRANSCRIPT="$(pwd)/tests/harness/transcripts/chatgpt-success.json" \
CODEX_PLUGIN_ARGS='["exec"]' \
  node -e "import('./dist/index.js').then(async m => { const p = m.createImageProvider({model:'gpt-image-2'}); const r = await p.generate({prompt:'x',size:'1024x1024',quality:'low',format:'png'}); console.log(r.provider, r.model, r.requestId, Buffer.from(r.base64,'base64').length+'B'); })"
```

`transcripts/chatgpt-success.example.json` is a placeholder (1×1 PNG). Replace it
with a **recorded** transcript and re-record periodically to drift-check the fake
against real codex — that is the discipline that prevents "author-derived fakes
quietly confirming a wrong mental model."

## Why this ordering

`P1-2` and `P2-5` did not even need real codex — they were catchable by a proper
MCP-protocol test and a CI convention. `P1-1 / P1-3 / P2-4` genuinely require the
real-codex boundary. The kit provides both: layer-correct tests you can run
today, plus the opt-in real-codex E2E and record/replay for the rest.
