import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("server modules never import browser-owned src modules", async () => {
  const files = (await readdir("server")).filter((name) => name.endsWith(".ts"));
  const violations: string[] = [];
  for (const name of files) {
    const source = await readFile(join("server", name), "utf8");
    if (/from\s+["'][^"']*(?:\.\.\/)+src(?:\/|["'])/.test(source)) violations.push(name);
  }
  expect(violations).toEqual([]);
});
