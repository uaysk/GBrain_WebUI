import { describe, expect, test } from "bun:test";
import { normalizePublicOrigin } from "../server/config";

describe("public origin configuration", () => {
  test("normalizes an HTTP(S) origin", () => {
    expect(normalizePublicOrigin(undefined)).toBeNull();
    expect(normalizePublicOrigin("  https://GD.UAYSK.COM:443/  ")).toBe("https://gd.uaysk.com");
    expect(normalizePublicOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  test("rejects values that are not an origin-only HTTP(S) URL", () => {
    for (const value of [
      "javascript:alert(1)",
      "https://user:secret@gd.uaysk.com",
      "https://gd.uaysk.com/control",
      "https://gd.uaysk.com?next=/control",
      "https://gd.uaysk.com#control",
    ]) {
      expect(() => normalizePublicOrigin(value)).toThrow();
    }
  });
});
