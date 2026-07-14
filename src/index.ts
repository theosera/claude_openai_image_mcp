#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createProvider } from "./imageProvider.js";
import { log } from "./logging.js";
import { buildMcpServer } from "./server.js";

// Fail-closed at startup: loadConfig / createProvider throw (secret-free) on any
// misconfiguration, so we never expose a half-configured tool over stdio.
const config = loadConfig();
const provider = createProvider(config);

const server = buildMcpServer({ config, provider });
await server.connect(new StdioServerTransport());

// stderr only — stdout carries the MCP protocol stream on stdio.
log.info("server.ready", {
  transport: "stdio",
  provider: provider.kind,
  model: config.model,
  max_concurrency: config.limits.maxConcurrency
});
