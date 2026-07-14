<!--
Reviewer focus (human + CodeRabbit + Codex). Please verify these explicitly.
-->

## What & why

<!-- One or two sentences: what this PR changes and the reason. -->

## Change classification

<!-- Keep PRs single-purpose. Do not bundle unrelated changes. -->

- [ ] Single, coherent change (not a bundle of unrelated edits)
- [ ] Scope matches the linked issue/plan

## Security & safety checklist

- [ ] **No secrets** committed (no `OPENAI_API_KEY`, tokens, `.env`; only `.env.example` with empty values)
- [ ] Requests are validated against the **allowlist** (size / quality / output_format) before any provider call
- [ ] Logs contain **metadata only** — no prompt text, no API key, no image base64 (redaction preserved)
- [ ] No **live OpenAI call / billing** introduced without explicit approval (mock stays the default)
- [ ] Provisional bounds (timeout / retries / concurrency / prompt length) keep a documented review condition

## Verification

- [ ] `pnpm run lint:ox && pnpm run format:check && pnpm run lint && pnpm run typecheck`
- [ ] `pnpm run build`
- [ ] `pnpm test`

## Notes for reviewers

<!-- Anything CodeRabbit / Codex should pay special attention to. -->
