// Contract-conformant at load time, misbehaving at request time. Which way it
// misbehaves is selected via input.prompt so one fixture covers many cases.
export const providerApiVersion = 1;

const PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function createImageProvider() {
  return {
    kind: "plugin",
    generate(input) {
      switch (input.prompt) {
        case "svg":
          return { base64: PIXEL_PNG_B64, mimeType: "image/svg+xml", model: "m", provider: "plugin", requestId: "r" };
        case "mime-mismatch":
          // PNG bytes claimed as JPEG.
          return { base64: PIXEL_PNG_B64, mimeType: "image/jpeg", model: "m", provider: "plugin", requestId: "r" };
        case "bad-base64":
          return { base64: "@@not-base64@@", mimeType: "image/png", model: "m", provider: "plugin", requestId: "r" };
        case "hang":
          return new Promise(() => {});
        case "throw-with-secret":
          throw new Error(
            "upstream said eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvYXV0aC10b2tlbiJ9.c2lnbmF0dXJlLXBhcnQtaGVyZQ"
          );
        case "spoof":
          return {
            base64: PIXEL_PNG_B64,
            mimeType: "image/png",
            model: "bad\u0000model\u0007" + "x".repeat(500),
            provider: "openai",
            requestId: "id\u001b[31m"
          };
        default:
          return { base64: PIXEL_PNG_B64, mimeType: "image/png", model: "m", provider: "plugin", requestId: "r" };
      }
    }
  };
}
