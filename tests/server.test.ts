import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createProvider, type ImageProvider } from "../src/imageProvider.js";
import { buildMcpServer } from "../src/server.js";

async function connect(providerOverride?: ImageProvider) {
  const config = loadConfig({ IMAGE_MCP_PROVIDER: "mock" });
  const provider = providerOverride ?? (await createProvider(config, {}));
  const server = buildMcpServer({ config, provider });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("generate_image tool", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    ctx = await connect();
  });

  afterEach(async () => {
    await ctx.client.close();
    await ctx.server.close();
  });

  it("advertises exactly the generate_image tool", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["generate_image"]);
    expect(tools[0].annotations?.readOnlyHint).toBe(false);
    expect(tools[0].outputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["provider", "requested_output_format", "output_format", "request_id"])
    });
  });

  it("returns MCP image content for a valid prompt", async () => {
    const res: any = await ctx.client.callTool({ name: "generate_image", arguments: { prompt: "a red circle" } });
    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("image");
    expect(res.content[0].mimeType).toBe("image/png");
    expect(typeof res.content[0].data).toBe("string");
    // base64, no data-URL prefix.
    expect(res.content[0].data.startsWith("data:")).toBe(false);
    expect(res.structuredContent).toMatchObject({
      provider: "mock",
      model: "gpt-image-2",
      size: "1024x1024",
      quality: "low",
      requested_output_format: "png",
      output_format: "png"
    });
  });

  it("reports requested and actual formats when the provider returns a different format", async () => {
    const res: any = await ctx.client.callTool({
      name: "generate_image",
      arguments: { prompt: "x", size: "1536x1024", quality: "medium", output_format: "webp" }
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].mimeType).toBe("image/png");
    expect(res.structuredContent).toMatchObject({
      size: "1536x1024",
      quality: "medium",
      requested_output_format: "webp",
      output_format: "png"
    });
  });

  it("propagates MCP sender cancellation to the provider signal", async () => {
    await ctx.client.close();
    await ctx.server.close();

    let started = false;
    let observedAbort = false;
    const provider: ImageProvider = {
      kind: "plugin",
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          started = true;
          const onAbort = (): void => {
            observedAbort = true;
            reject(new Error("cancelled by sender"));
          };
          if (signal?.aborted) {
            onAbort();
          } else {
            signal?.addEventListener("abort", onAbort, { once: true });
          }
        })
    };
    ctx = await connect(provider);

    const controller = new AbortController();
    const call = ctx.client.callTool({ name: "generate_image", arguments: { prompt: "cancel me" } }, undefined, {
      signal: controller.signal
    });
    await vi.waitFor(() => expect(started).toBe(true));
    controller.abort();

    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(observedAbort).toBe(true));
  });

  it("rejects an output_format outside the allowlist before any provider call", async () => {
    const res: any = await ctx.client.callTool({
      name: "generate_image",
      arguments: { prompt: "x", output_format: "gif" }
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not allowed/);
  });

  it("rejects a size outside the allowlist", async () => {
    const res: any = await ctx.client.callTool({
      name: "generate_image",
      arguments: { prompt: "x", size: "9999x9999" }
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not allowed/);
  });

  it("rejects an empty prompt via schema", async () => {
    const res: any = await ctx.client.callTool({ name: "generate_image", arguments: { prompt: "" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/validation|characters|too_small/i);
  });
});
