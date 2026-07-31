import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const violations: string[] = [];
for (const file of await sourceFiles("server")) {
  const source = await readFile(file, "utf8");
  if (/from\s+["'][^"']*(?:\.\.\/)+src(?:\/|["'])/.test(source)) {
    violations.push(`${relative(process.cwd(), file)} imports browser-owned src/ code`);
  }
}
if (violations.length) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log("Architecture lint passed (server has no src/ imports).");
