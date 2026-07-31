import { z } from "zod";
import { apiRequest, type ApiRequestOptions } from "./api-client.js";
import { apiConfigFromEnv } from "./config.js";
import type { GraphifySynthesis, HybridQueryResult } from "./types.js";

const synthesisResultSchema = z.object({
  answer: z.string().min(1),
  evidence: z.array(z.object({
    nodeId: z.string().min(1),
    label: z.string(),
    sourceFile: z.string(),
    sourceLocation: z.string(),
    reason: z.string().min(1),
  }).strict()),
  limitations: z.array(z.string()),
}).strict();

function synthesisJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer", "evidence", "limitations"],
    properties: {
      answer: { type: "string" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nodeId", "label", "sourceFile", "sourceLocation", "reason"],
          properties: {
            nodeId: { type: "string" },
            label: { type: "string" },
            sourceFile: { type: "string" },
            sourceLocation: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      limitations: { type: "array", items: { type: "string" } },
    },
  };
}

export function validateSynthesis(value: unknown): GraphifySynthesis {
  const parsed = synthesisResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Synthesis response shape mismatch: ${parsed.error.issues[0]?.message || "invalid response"}`);
  }
  return parsed.data;
}

export async function synthesizeWithModel(
  result: Omit<HybridQueryResult, "synthesis">,
  options: ApiRequestOptions = {},
): Promise<GraphifySynthesis> {
  const config = options.config || apiConfigFromEnv({ cache: true });
  const evidence = {
    seeds: result.seeds.map(({ searchText: _searchText, ...seed }) => seed),
    nodes: result.nodes.slice(0, 80).map((node) => ({
      id: node.id,
      label: node.label,
      source_file: node.source_file,
      source_location: node.source_location,
      community_name: node.community_name,
    })),
    links: result.links.slice(0, 160).map((link) => ({
      source: link.source,
      target: link.target,
      relation: link.relation,
      confidence: link.confidence,
    })),
  };
  const response = await apiRequest<unknown>("/chat/completions", {
    model: config.synthesisModel,
    messages: [
      {
        role: "system",
        content: [
          "You answer codebase questions from a bounded Graphify subgraph.",
          "Use only the supplied nodes and links. Never invent an edge.",
          "Answer in Korean unless the user asks otherwise.",
          "Cite concrete source_file and source_location values in the answer.",
          "If evidence is insufficient, state that in limitations.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Question:\n${result.question}\n\nGraph evidence:\n${JSON.stringify(evidence)}`,
      },
    ],
    max_completion_tokens: 4_000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "graphify_hybrid_answer",
        strict: true,
        schema: synthesisJsonSchema(),
      },
    },
  }, { ...options, config });
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Synthesis response is missing message content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Synthesis model ${config.synthesisModel} did not return valid JSON`);
  }
  return validateSynthesis(parsed);
}
