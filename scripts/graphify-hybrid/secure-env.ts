import { lstat, readFile } from "node:fs/promises";

function parseValue(raw: string, lineNumber: number): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`Malformed quoted value on line ${lineNumber}`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`Malformed quoted value on line ${lineNumber}`);
    return value.slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export async function loadSecureEnvFile(file: string): Promise<void> {
  process.umask(0o077);
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${file} must be a regular, non-symlink file`);
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (metadata.uid !== currentUid) throw new Error(`${file} must be owned by the current user`);
  if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${file} must have mode 0600 exactly`);

  const content = await readFile(file, "utf8");
  for (const [offset, original] of content.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(normalized);
    if (!match) throw new Error(`Invalid environment assignment on line ${offset + 1}`);
    process.env[match[1]] = parseValue(match[2], offset + 1);
  }
}
