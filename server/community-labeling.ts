const GENERIC = new Set([
  "concept", "note", "notes", "project", "projects", "project_note", "log", "guide", "analysis", "memory",
  "incident", "snapshot", "extract", "receipt", "page", "gbrain", "the", "and", "for", "with", "from",
]);

export interface CommunityLabelPage { title: string; type: string; tags: string[] | null }

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-").replace(/^[-·]+|[-·]+$/g, "");
const usable = (value: string) => value.length >= 2 && value.length <= 32 && !GENERIC.has(value) && !/^\d+(?:[-.:]\d+)*$/.test(value);

function titleTokens(title: string): string[] {
  return title.split(/[^\p{L}\p{N}+#.-]+/u).map(normalize).filter(usable);
}

function rankedKeywords(pages: CommunityLabelPage[]): string[] {
  const scores = new Map<string, { score: number; count: number }>();
  const add = (raw: string, weight: number) => {
    const token = normalize(raw);
    if (!usable(token)) return;
    const current = scores.get(token) ?? { score: 0, count: 0 };
    scores.set(token, { score: current.score + weight, count: current.count + 1 });
  };
  for (const page of pages) {
    for (const tag of page.tags ?? []) add(tag, 4);
    if (!GENERIC.has(normalize(page.type))) add(page.type, 1.5);
    for (const token of titleTokens(page.title)) add(token, 1);
  }
  return [...scores.entries()]
    .sort((left, right) => right[1].score - left[1].score || right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([token]) => token);
}

export function createCommunityNames(communities: CommunityLabelPage[][]): string[] {
  const ranked = communities.map(rankedKeywords);
  const bases = ranked.map((keywords, index) => keywords.slice(0, 2).join(" · ") || `memory-${index + 1}`);
  const duplicates = new Map<string, number[]>();
  bases.forEach((base, index) => duplicates.set(base, [...(duplicates.get(base) ?? []), index]));
  const names = [...bases];
  for (const indexes of duplicates.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const primary = ranked[index]?.[0] ?? "memory";
      const discriminator = ranked[index]?.find((token) => token !== primary && !bases[index]!.includes(token))
        ?? titleTokens(communities[index]?.[0]?.title ?? "").find((token) => token !== primary)
        ?? String(index + 1).padStart(2, "0");
      names[index] = `${primary} · ${discriminator}`;
    }
  }
  const seen = new Map<string, number>();
  return names.map((name) => {
    const occurrence = (seen.get(name) ?? 0) + 1;
    seen.set(name, occurrence);
    return occurrence === 1 ? name : `${name}-${occurrence}`;
  });
}
