#!/usr/bin/env bun
import path from "node:path";
import { benchmarkFingerprint } from "./benchmark.js";
import { loadSecureEnvFile } from "./secure-env.js";

const graphPath = process.argv[2] || "graphify-out/graph.json";
const root = process.argv[3] || ".";
await loadSecureEnvFile(path.resolve(root, ".env.graphify"));
console.log(await benchmarkFingerprint(graphPath));
