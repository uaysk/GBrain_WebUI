import { z } from "zod";
import { DEFAULT_GRAPH, DEFAULT_PROJECT } from "./types.js";

const projectSchema = z.literal(DEFAULT_PROJECT, {
  error: `This repository launcher only supports --project ${DEFAULT_PROJECT}`,
});
const pathSchema = z.string().min(1);
const integerText = (name: string, minimum: number, maximum: number, fallback: number) => z
  .string()
  .default(String(fallback))
  .refine((value) => /^(0|[1-9]\d*)$/.test(value), `${name} must be an integer`)
  .transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));

type RawOptions = Record<string, string | boolean>;

const commandOptions = {
  setup: { values: [], flags: [] },
  index: {
    values: ["graph", "root", "project", "sha", "batch-size", "concurrency"],
    flags: [],
  },
  query: {
    values: ["graph", "project", "top-k", "seeds", "depth", "context"],
    flags: ["no-reranker", "no-synthesis"],
  },
  benchmark: { values: ["graph", "project", "out"], flags: [] },
  status: { values: ["graph", "root", "project"], flags: [] },
} as const;

export type CliOptions =
  | { command: "setup" }
  | {
    command: "index";
    graph: string;
    root: string;
    project: typeof DEFAULT_PROJECT;
    sha?: string;
    batchSize: number;
    concurrency: number;
  }
  | {
    command: "query";
    question: string;
    graph: string;
    project: typeof DEFAULT_PROJECT;
    topK: number;
    seedCount: number;
    depth: number;
    contextFilters: string[];
    useReranker: boolean;
    synthesize: boolean;
  }
  | {
    command: "benchmark";
    graph: string;
    project: typeof DEFAULT_PROJECT;
    output?: string;
  }
  | {
    command: "status";
    graph: string;
    root: string;
    project: typeof DEFAULT_PROJECT;
  };

function parseTokens(command: keyof typeof commandOptions, args: string[]) {
  const specification = commandOptions[command];
  const valueNames = new Set<string>(specification.values);
  const flagNames = new Set<string>(specification.flags);
  const options: RawOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const separator = token.indexOf("=");
    const name = token.slice(2, separator < 0 ? undefined : separator);
    if (!name || (!valueNames.has(name) && !flagNames.has(name))) {
      throw new Error(`Unknown option for ${command}: --${name}`);
    }
    if (name in options) throw new Error(`Duplicate option: --${name}`);
    if (flagNames.has(name)) {
      if (separator >= 0) throw new Error(`Flag --${name} does not accept a value`);
      options[name] = true;
      continue;
    }
    const value = separator >= 0 ? token.slice(separator + 1) : args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Option --${name} requires a value`);
    options[name] = value;
  }
  return { options, positionals };
}

function stringOption(options: RawOptions, name: string, fallback?: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : fallback;
}

function rejectPositionals(command: string, positionals: string[]): void {
  if (positionals.length > 0) throw new Error(`${command} does not accept positional arguments`);
}

export function parseCliArgs(args: string[]): CliOptions {
  const command = args[0] as keyof typeof commandOptions | undefined;
  if (!command || !(command in commandOptions)) {
    throw new Error("Usage: graphify-hybrid <setup|index|query|benchmark|status>");
  }
  const { options, positionals } = parseTokens(command, args.slice(1));
  if (command === "setup") {
    rejectPositionals(command, positionals);
    return { command };
  }
  if (command === "index") {
    rejectPositionals(command, positionals);
    const parsed = z.object({
      graph: pathSchema.default(DEFAULT_GRAPH),
      root: pathSchema.default("."),
      project: projectSchema.default(DEFAULT_PROJECT),
      sha: z.string().regex(/^[a-f\d]{64}$/i, "--sha must be a SHA-256 digest").optional(),
      batchSize: integerText("--batch-size", 1, 64, 64),
      concurrency: integerText("--concurrency", 1, 8, 4),
    }).parse({
      graph: stringOption(options, "graph"),
      root: stringOption(options, "root"),
      project: stringOption(options, "project"),
      sha: stringOption(options, "sha"),
      batchSize: stringOption(options, "batch-size"),
      concurrency: stringOption(options, "concurrency"),
    });
    return { command, ...parsed };
  }
  if (command === "query") {
    if (positionals.length !== 1 || !positionals[0].trim()) {
      throw new Error("Usage: graphify-hybrid query \"<question>\"");
    }
    const parsed = z.object({
      graph: pathSchema.default(DEFAULT_GRAPH),
      project: projectSchema.default(DEFAULT_PROJECT),
      topK: integerText("--top-k", 10, 100, 50),
      seedCount: integerText("--seeds", 1, 10, 5),
      depth: integerText("--depth", 0, 4, 2),
      context: z.string().default(""),
    }).parse({
      graph: stringOption(options, "graph"),
      project: stringOption(options, "project"),
      topK: stringOption(options, "top-k"),
      seedCount: stringOption(options, "seeds"),
      depth: stringOption(options, "depth"),
      context: stringOption(options, "context"),
    });
    return {
      command,
      question: positionals[0],
      graph: parsed.graph,
      project: parsed.project,
      topK: parsed.topK,
      seedCount: parsed.seedCount,
      depth: parsed.depth,
      contextFilters: parsed.context.split(",").map((value) => value.trim()).filter(Boolean),
      useReranker: options["no-reranker"] !== true,
      synthesize: options["no-synthesis"] !== true,
    };
  }
  if (command === "benchmark") {
    rejectPositionals(command, positionals);
    const parsed = z.object({
      graph: pathSchema.default(DEFAULT_GRAPH),
      project: projectSchema.default(DEFAULT_PROJECT),
      output: pathSchema.optional(),
    }).parse({
      graph: stringOption(options, "graph"),
      project: stringOption(options, "project"),
      output: stringOption(options, "out"),
    });
    return { command, ...parsed };
  }
  rejectPositionals(command, positionals);
  const parsed = z.object({
    graph: pathSchema.default(DEFAULT_GRAPH),
    root: pathSchema.default("."),
    project: projectSchema.default(DEFAULT_PROJECT),
  }).parse({
    graph: stringOption(options, "graph"),
    root: stringOption(options, "root"),
    project: stringOption(options, "project"),
  });
  return { command, ...parsed };
}
