// Simulates a plugin whose import fails with a secret in the message; the
// core's load error must come out redacted.
throw new Error("boom with sk-abcdefghijklmnop1234 inside");
