import { describe, expect, test } from "bun:test";
import { createCommunityNames } from "../server/community-labeling";

describe("community naming", () => {
  test("prefers tags and title keywords over generic page types", () => {
    const names = createCommunityNames([
      [
        { title: "Kubernetes ingress rollout", type: "concept", tags: ["kubernetes", "networking"] },
        { title: "Traefik routing notes", type: "note", tags: ["kubernetes", "traefik"] },
      ],
      [
        { title: "PostgreSQL backup policy", type: "project", tags: ["postgresql", "backup"] },
      ],
    ]);
    expect(names[0]).toContain("kubernetes");
    expect(names[1]).toContain("postgresql");
    expect(names.every((name) => !/^(concept|note|project)(?:\s|$)/.test(name))).toBe(true);
  });

  test("distinguishes duplicate bases deterministically", () => {
    const communities = [
      [{ title: "Alpha cluster operations", type: "note", tags: ["kubernetes", "operations"] }],
      [{ title: "Beta cluster operations", type: "note", tags: ["kubernetes", "operations"] }],
    ];
    const first = createCommunityNames(communities);
    const second = createCommunityNames(communities);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });
});
