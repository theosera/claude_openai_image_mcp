#!/usr/bin/env node
// Fake `codex` that never finishes on its own. The host abort path must
// terminate it (SIGTERM to the process group, then SIGKILL after the grace).
setInterval(() => {}, 1 << 30);
