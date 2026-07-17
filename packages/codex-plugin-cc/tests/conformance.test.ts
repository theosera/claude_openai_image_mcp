import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCodexConfig } from "../src/config.js";
import { createCodexImageProvider } from "../src/codexProvider.js";

/**
 * CONFORMANCE / DEFINITION-OF-DONE for the Codex-review findings.
 *
 * Each block encodes an invariant as an executable spec, so the target is
 * red/green instead of prose. Findings that the current code does NOT yet
 * satisfy are `it.skip` / `it.todo` with the exact expected behavior — flip
 * them to active as each fix lands. See tests/README.md for the mapping.
 *
 * WHY this file exists: the original fixtures encoded the author's assumptions
 * (a fake codex that prints "Logged in using ChatGPT" and writes a PNG), so the
 * tests passed by construction and never challenged those assumptions. These
 * conformance specs are written from the DESIRED contract, not the current code.
 */

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const baseInput = { prompt: "x", size: "1024x1024", quality: "low", format: "png" };

function provider(fixtureName: string, extra: NodeJS.ProcessEnv = {}) {
  return createCodexImageProvider(
    loadCodexConfig("gpt-image-2", {
      CODEX_PLUGIN_COMMAND: fixture(fixtureName),
      CODEX_PLUGIN_ARGS: '["exec"]',
      ...extra
    })
  );
}

describe("P1-1 · subscription-only auth (reject stored/API-key auth)", () => {
  // Root cause: checkCodexLogin matches /logged in/i, which accepts BOTH
  // "Logged in using ChatGPT" and "Logged in using API key"; and stripping env
  // keys does not remove a persisted `codex login --with-api-key` credential.
  // DoD: assert the auth METHOD is ChatGPT before the first generation, and
  //      fail closed (codex_not_logged_in / a dedicated code) otherwise.
  it.skip("rejects when codex is authenticated via API key, not ChatGPT", async () => {
    const p = provider("fake-codex-apikey-auth.mjs", { CODEX_PLUGIN_PREFLIGHT_LOGIN: "1" });
    await expect(p.generate(baseInput)).rejects.toMatchObject({ code: "codex_not_logged_in" });
  });

  it.todo("preflight auth-method check runs by default (not opt-in) for the subscription lane");
});

describe("P1-2 · MCP client cancellation reaches codex", () => {
  // Root cause: server.ts tool handler never receives the MCP callback's
  // extra.signal, and providerGuard overwrites input.signal with its own
  // timeout controller. A client cancel therefore cannot abort codex.
  // DoD (host-level, wire in src/server.ts + src/providerGuard.ts):
  //   - thread extra.signal from registerTool's 2nd arg into provider.generate;
  //   - compose it with the guard timeout via AbortSignal.any([client, timeout]);
  //   - add a protocol test: client callTool({signal}) → abort → codex killed
  //     well before IMAGE_MCP_TIMEOUT_MS.
  it.todo("aborting the MCP tool call kills codex before the guard timeout (AbortSignal.any)");
});

describe("P1-3 · child codex runs isolated & ephemeral", () => {
  // Root cause: default args were taken from community examples (`--full-auto`,
  // now a deprecated compat flag) without checking the current codex manual, and
  // the child inherits the user's ~/.codex config and persists session history.
  // DoD (exact flags to be confirmed from `codex exec --help` on the target
  //      version): ephemeral session, explicit workspace-write sandbox,
  //      --ignore-user-config or a dedicated CODEX_HOME, minimal env; drop the
  //      reliance on --full-auto.
  it.todo("default baseArgs isolate the child (ephemeral / ignore-user-config / explicit sandbox)");
  it.todo("child does not persist session history to the user's CODEX_HOME");
});

describe("P2-4 · returned MIME matches the actual bytes", () => {
  // Root cause: mimeType is derived from the REQUESTED format, not the bytes
  // codex actually wrote. A PNG saved as image.webp is only caught by the host
  // guard (magic-byte mismatch) — the plugin advertises webp/jpeg it cannot
  // guarantee. DoD: EITHER restrict the plugin lane to PNG-only (reject other
  // formats up front), OR detect the real format from magic bytes and report /
  // convert accordingly. The spec below targets the PNG-only stance.
  it.skip("rejects a non-PNG format the lane cannot guarantee (PNG-only stance)", async () => {
    // fake-codex-success writes PNG bytes regardless of the requested extension.
    const p = provider("fake-codex-success.mjs");
    await expect(p.generate({ ...baseInput, format: "webp" })).rejects.toBeTruthy();
  });
});

describe("P2-5 · package is exercised in CI", () => {
  // Root cause: optimizing for 'keep the package out of the core CI scope'
  // (a real supply-chain goal) left the package's tests running NOWHERE in CI.
  // DoD: a dedicated, isolated CI job builds/typechecks/tests the package.
  // Satisfied by .github/workflows/codex-plugin.yml (see tests/README.md).
  it("has a build+typecheck+test entrypoint the CI job can invoke", () => {
    // Smoke: the package's public factory is importable and constructs a
    // provider — the same surface the CI `pnpm test` step exercises.
    expect(typeof provider("fake-codex-success.mjs").generate).toBe("function");
  });
});
