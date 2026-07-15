import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { MOCK_PNG_BASE64, createProvider } from "../src/imageProvider.js";
import { log, redact } from "../src/logging.js";
import { buildMcpServer } from "../src/server.js";

describe("redact()", () => {
  it("scrubs OpenAI-style keys", () => {
    const out = redact("using key sk-abcdEFGH1234567890zzz here");
    expect(out).not.toContain("sk-abcdEFGH1234567890zzz");
    expect(out).toContain("sk-***redacted***");
  });

  it("scrubs long base64 blobs (image data)", () => {
    const out = redact(`data ${MOCK_PNG_BASE64} end`);
    expect(out).not.toContain(MOCK_PNG_BASE64);
    expect(out).toContain("***base64-redacted***");
  });
});

describe("logger", () => {
  it("writes to stderr and redacts secret-shaped fields", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    log.info("test.event", { note: "leak sk-ABCDEFGHIJKLMNOP0123 here" });
    expect(spy).toHaveBeenCalledOnce();
    const written = String(spy.mock.calls[0][0]);
    expect(written).not.toContain("sk-ABCDEFGHIJKLMNOP0123");
    expect(written).toContain("sk-***redacted***");
    spy.mockRestore();
  });
});

describe("no secret / prompt / image bytes in logs during a real call", () => {
  it("logs only metadata for a successful generation", async () => {
    const captured: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      captured.push(String(chunk));
      return true;
    });

    const config = loadConfig({ IMAGE_MCP_PROVIDER: "mock" });
    const provider = await createProvider(config, {});
    const server = buildMcpServer({ config, provider });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "sec", version: "0.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const secretPrompt = "SUPER-SECRET-PROMPT-DO-NOT-LOG";
    await client.callTool({ name: "generate_image", arguments: { prompt: secretPrompt } });

    await client.close();
    await server.close();
    spy.mockRestore();

    const allLogs = captured.join("");
    expect(allLogs).not.toContain(secretPrompt);
    expect(allLogs).not.toContain(MOCK_PNG_BASE64);
    // But metadata IS present.
    expect(allLogs).toContain("generate_image.ok");
    expect(allLogs).toContain("provider=mock");
  });
});

describe("OpenAI provider never serializes its key", () => {
  it("keeps the api key out of JSON.stringify", async () => {
    const config = loadConfig({ IMAGE_MCP_PROVIDER: "openai" });
    const provider = await createProvider(config, { OPENAI_API_KEY: "sk-SHOULD-NOT-SERIALIZE-123456" });
    expect(JSON.stringify(provider)).not.toContain("sk-SHOULD-NOT-SERIALIZE-123456");
  });
});

describe("redact() covers OAuth-token shapes (plugin lane)", () => {
  it("scrubs JWTs (base64url), which the standard base64 pattern would miss", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0b2tlbi1ib2R5In0.c2ln-bmF0_dXJl";
    const out = redact(`token ${jwt} leaked`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("***jwt-redacted***");
  });

  it("scrubs long base64url runs", () => {
    const blob = "A-b_".repeat(30);
    const out = redact(`data ${blob} end`);
    expect(out).not.toContain(blob);
  });
});
