import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { ImageError } from "../src/errors.js";
import { MOCK_PNG_BASE64 } from "../src/imageProvider.js";
import { loadLimits } from "../src/limits.js";
import { type ImagesApi, OpenAIImageProvider } from "../src/openaiImageClient.js";
import { guardProvider } from "../src/providerGuard.js";

const limits = loadLimits({});
const input = { prompt: "a cat", size: "1024x1024", quality: "low", format: "png" };
const FAKE_KEY = "sk-test-not-real-0000000000";

function makeProvider(imagesApi: ImagesApi): OpenAIImageProvider {
  return new OpenAIImageProvider({ apiKey: FAKE_KEY, model: "gpt-image-2", limits, imagesApi });
}

function failingApi(err: unknown): ImagesApi {
  return {
    generate: async () => {
      throw err;
    }
  };
}

describe("OpenAIImageProvider (mock-reproduced upstream branches)", () => {
  it("returns the image with server-owned model and a request id", async () => {
    const provider = makeProvider({ generate: async () => ({ data: [{ b64_json: MOCK_PNG_BASE64 }] }) });
    const result = await provider.generate(input);
    expect(result.base64).toBe(MOCK_PNG_BASE64);
    expect(result.mimeType).toBe("image/png");
    expect(result.model).toBe("gpt-image-2");
    expect(result.provider).toBe("openai");
    expect(result.requestId).toMatch(/^openai-/);
  });

  it("prefers the SDK _request_id when present", async () => {
    const provider = makeProvider({
      generate: async () => ({ data: [{ b64_json: MOCK_PNG_BASE64 }], _request_id: "req_abc123" })
    });
    const result = await provider.generate(input);
    expect(result.requestId).toBe("req_abc123");
  });

  it("sends exactly the validated fields with n=1 and forwards the abort signal", async () => {
    const generate = vi.fn(async () => ({ data: [{ b64_json: MOCK_PNG_BASE64 }] }));
    const provider = makeProvider({ generate });
    const controller = new AbortController();
    await provider.generate({ ...input, signal: controller.signal });

    expect(generate).toHaveBeenCalledWith(
      {
        model: "gpt-image-2",
        prompt: "a cat",
        size: "1024x1024",
        quality: "low",
        output_format: "png",
        n: 1
      },
      { signal: controller.signal }
    );
  });

  it("fails typed when the response carries no b64_json", async () => {
    const provider = makeProvider({ generate: async () => ({ data: [{}] }) });
    await expect(provider.generate(input)).rejects.toThrow(/no image data/);
  });

  it("maps 401 to provider_unavailable without echoing the key", async () => {
    const err = OpenAI.APIError.generate(
      401,
      { error: { message: `Incorrect API key provided: ${FAKE_KEY}` } },
      `Incorrect API key provided: ${FAKE_KEY}`,
      new Headers()
    );
    const failure = makeProvider(failingApi(err)).generate(input);
    await expect(failure).rejects.toThrow(/401/);
    await expect(makeProvider(failingApi(err)).generate(input)).rejects.not.toThrow(new RegExp(FAKE_KEY));
    try {
      await makeProvider(failingApi(err)).generate(input);
    } catch (thrown) {
      expect((thrown as ImageError).code).toBe("provider_unavailable");
    }
  });

  it("maps 429 to a typed rate-limit error surfacing Retry-After", async () => {
    const err = OpenAI.APIError.generate(
      429,
      { error: { message: "rate limited" } },
      "rate limited",
      new Headers({ "retry-after": "7" })
    );
    await expect(makeProvider(failingApi(err)).generate(input)).rejects.toThrow(/429.*Retry after 7s/);
  });

  it("maps 5xx to a typed upstream error with the status", async () => {
    const err = OpenAI.APIError.generate(500, { error: { message: "oops" } }, "oops", new Headers());
    await expect(makeProvider(failingApi(err)).generate(input)).rejects.toThrow(/status 500/);
  });

  it("maps SDK timeouts and connection failures distinctly", async () => {
    const timeout = new OpenAI.APIConnectionTimeoutError({ message: "deadline" });
    await expect(makeProvider(failingApi(timeout)).generate(input)).rejects.toThrow(/timed out/);

    const conn = new OpenAI.APIConnectionError({ message: "ECONNREFUSED" });
    await expect(makeProvider(failingApi(conn)).generate(input)).rejects.toThrow(/connection error/);
  });

  it("redacts secret-shaped content in unexpected errors", async () => {
    const blob = MOCK_PNG_BASE64;
    const err = new Error(`weird failure carrying ${blob}`);
    const failure = makeProvider(failingApi(err)).generate(input);
    await expect(failure).rejects.toThrow(/base64-redacted/);
    await expect(makeProvider(failingApi(err)).generate(input)).rejects.not.toThrow(new RegExp(blob.slice(0, 40)));
  });
});

describe("OpenAIImageProvider behind the guard", () => {
  it("passes a well-formed live-shaped response end-to-end", async () => {
    const guarded = guardProvider(
      makeProvider({ generate: async () => ({ data: [{ b64_json: MOCK_PNG_BASE64 }] }) }),
      limits
    );
    const result = await guarded.generate(input);
    expect(result.provider).toBe("openai");
    expect(result.mimeType).toBe("image/png");
  });

  it("scrubs the prompt when a typed upstream error echoes it", async () => {
    const prompt = "SECRET-USER-PROMPT-42";
    const err = OpenAI.APIError.generate(
      400,
      { error: { message: `bad prompt: ${prompt}` } },
      `bad prompt: ${prompt}`,
      new Headers()
    );
    const guarded = guardProvider(makeProvider(failingApi(err)), limits);
    await expect(guarded.generate({ ...input, prompt })).rejects.toThrow(/prompt-redacted/);
    await expect(guarded.generate({ ...input, prompt })).rejects.not.toThrow(new RegExp(prompt));
  });

  it("rejects upstream bytes that do not match the requested format", async () => {
    // Valid base64, but not a PNG — the guard must fail closed even though the
    // upstream call "succeeded".
    const notPng = Buffer.from("hello, not an image").toString("base64");
    const guarded = guardProvider(makeProvider({ generate: async () => ({ data: [{ b64_json: notPng }] }) }), limits);
    await expect(guarded.generate(input)).rejects.toThrow(/do not match/);
  });
});
