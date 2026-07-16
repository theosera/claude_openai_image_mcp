// Declares an incompatible provider API version; the core must refuse to start.
export const providerApiVersion = 999;

export function createImageProvider() {
  throw new Error("should never be called");
}
