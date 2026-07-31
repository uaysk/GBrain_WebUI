#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecureEnvFile } from "./secure-env.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, "../..");

async function main(): Promise<void> {
  await loadSecureEnvFile(path.join(projectRoot, ".env.graphify"));
  const target = process.argv[2];
  if (target === "cli") {
    const { runCli } = await import("./cli.js");
    await runCli(process.argv.slice(3));
  } else if (target === "mcp") {
    await import("./mcp.js");
  } else {
    throw new Error("Graphify hybrid launcher target must be cli or mcp");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
