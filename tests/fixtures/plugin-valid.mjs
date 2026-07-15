// Minimal well-behaved provider plugin (contract v1) used by tests only.
export const providerApiVersion = 1;

// Same 1x1 transparent PNG as fixtures/pixel.png.b64.
const PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function createImageProvider(ctx) {
  return {
    kind: "plugin",
    async generate(input) {
      return {
        base64: PIXEL_PNG_B64,
        mimeType: "image/png",
        // A subscription-style backend reports what it actually used — which
        // may differ from ctx.model (advisory).
        model: `backend-of-${ctx.model}`,
        provider: "plugin",
        requestId: `fixture-${input.size}`
      };
    }
  };
}
