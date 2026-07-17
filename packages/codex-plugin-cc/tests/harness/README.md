# Record/replay harness

A deterministic, **observation-derived** fake `codex` for this package's tests.

The hand-written fakes in [`../fixtures/`](../fixtures/) encode an author's
_assumptions_ about how `codex` behaves. This harness instead **replays a
transcript recorded from a real `codex` run**, so the happy path is validated
against ground truth — with no network and no ChatGPT subscription in CI.

## Files

| File                                       | Role                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record.mjs`                               | **Recorder.** Drives the real `codex` binary once (login preflight + `exec`) and prints a transcript JSON. Opt-in; consumes your ChatGPT subscription. Never runs in CI.                    |
| `transcript-codex.mjs`                     | **Replay driver.** A drop-in fake `codex` that replays a transcript. Spawned exactly where the real binary would be, so it honors both call shapes: `login status` and `exec … "<prompt>"`. |
| `transcripts/chatgpt-success.example.json` | **Seed transcript.** Carries the canonical 1×1 PNG so replay yields a valid image deterministically. Re-record to capture a full-size image.                                                |

Replayed by [`../harness.test.ts`](../harness.test.ts).

## Record a fresh transcript

```sh
codex login                                   # ChatGPT subscription
cd packages/codex-plugin-cc && pnpm run build
node tests/harness/record.mjs > tests/harness/transcripts/chatgpt-success.json
```

## Why the driver resolves its transcript relative to itself

The provider's mandatory login preflight (`src/codex.ts`) spawns a **fixed**
`["login","status"]` argv through the **strict env allowlist** in
`src/config.ts` (`codexChildEnv`). Neither an extra CLI flag nor a custom env
var survives to that call, so the driver cannot be _told_ which transcript to
use on login. It therefore resolves `transcripts/chatgpt-success.example.json`
**relative to itself**, which works identically for the login and `exec` calls.
An explicit `--transcript <path>` flag (present only on the `exec` argv, via
`CODEX_PLUGIN_ARGS`) overrides the default when a test needs another recording.
