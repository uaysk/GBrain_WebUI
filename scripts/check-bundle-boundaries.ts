#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const baselineGzipBytes = 494.52 * 1_024;
const maximumControlInitialBytes = baselineGzipBytes * 0.75;
const distRoot = path.resolve("dist");
const indexHtml = await readFile(path.join(distRoot, "index.html"), "utf8");
const entryPath = /<script[^>]+src="([^"]+\.js)"/.exec(indexHtml)?.[1];
if (!entryPath) throw new Error("Unable to find the production entry script");
const assets = await readdir(path.join(distRoot, "assets"));
const controlChunk = assets.find((file) => /^ControlCenter-.+\.js$/.test(file));
if (!controlChunk) throw new Error("ControlCenter must remain a lazy production chunk");

async function gzipBytes(file: string): Promise<number> {
  return gzipSync(await readFile(file)).byteLength;
}

const entryFile = path.join(distRoot, entryPath.replace(/^\//, ""));
const controlFile = path.join(distRoot, "assets", controlChunk);
const entryGzipBytes = await gzipBytes(entryFile);
const controlGzipBytes = await gzipBytes(controlFile);
const controlInitialGzipBytes = entryGzipBytes + controlGzipBytes;
if (controlInitialGzipBytes > maximumControlInitialBytes) {
  throw new Error(
    `Control initial JS is ${(controlInitialGzipBytes / 1_024).toFixed(2)} KiB gzip; `
    + `the 25% reduction ceiling is ${(maximumControlInitialBytes / 1_024).toFixed(2)} KiB`,
  );
}
console.log(JSON.stringify({
  baselineGzipKiB: Number((baselineGzipBytes / 1_024).toFixed(2)),
  entryGzipKiB: Number((entryGzipBytes / 1_024).toFixed(2)),
  controlChunkGzipKiB: Number((controlGzipBytes / 1_024).toFixed(2)),
  controlInitialGzipKiB: Number((controlInitialGzipBytes / 1_024).toFixed(2)),
  reductionPct: Number(((1 - controlInitialGzipBytes / baselineGzipBytes) * 100).toFixed(1)),
}, null, 2));
