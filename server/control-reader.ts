import { McpToolClient } from "./mcp-client";

type JsonRecord = Record<string, unknown>;

export interface ControlReadResult {
  status: unknown | null;
  recentJobs: unknown[] | null;
  fullRuns: unknown[] | null;
  globalRuns: unknown[] | null;
  partial: boolean;
}

export interface ControlReader {
  read(): Promise<ControlReadResult>;
  close?(): Promise<void>;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function decodeControlToolPayload(value: unknown): unknown {
  const result = record(value);
  if (result.isError === true) throw new Error("GBrain MCP tool returned an error");
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const content = list(result.content);
  const block = content.map(record).find((item) => item.type === "text" && typeof item.text === "string");
  if (!block) throw new Error("GBrain MCP tool returned no structured text");
  try {
    return JSON.parse(block.text as string);
  } catch {
    throw new Error("GBrain MCP tool returned invalid JSON");
  }
}

type DecodedToolResult = { ok: true; value: unknown } | { ok: false; value: null };

function decodeSettledToolResult(
  result: PromiseSettledResult<unknown>,
  shape: "object" | "array",
): DecodedToolResult {
  if (result.status === "rejected") return { ok: false, value: null };
  try {
    const value = decodeControlToolPayload(result.value);
    const valid = shape === "array"
      ? Array.isArray(value)
      : value !== null && typeof value === "object" && !Array.isArray(value);
    return valid ? { ok: true, value } : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

export class McpControlReader implements ControlReader {
  private readonly client: McpToolClient;

  constructor(url: string, token: string, timeoutMs: number) {
    this.client = new McpToolClient(url, token, timeoutMs, "gbrain-webui-control-center-query");
  }

  async read(): Promise<ControlReadResult> {
    const [statusResult, jobsResult, fullRunsResult, globalRunsResult] = await Promise.allSettled([
      this.client.callTool("get_status_snapshot", {}),
      this.client.callTool("list_jobs", { limit: 30 }),
      this.client.callTool("list_jobs", { name: "autopilot-cycle", limit: 5 }),
      this.client.callTool("list_jobs", { name: "autopilot-global-maintenance", limit: 5 }),
    ]);
    const statusRead = decodeSettledToolResult(statusResult, "object");
    const jobsRead = decodeSettledToolResult(jobsResult, "array");
    const fullRunsRead = decodeSettledToolResult(fullRunsResult, "array");
    const globalRunsRead = decodeSettledToolResult(globalRunsResult, "array");
    const reads = [statusRead, jobsRead, fullRunsRead, globalRunsRead];
    if (!reads.some((result) => result.ok)) throw new Error("All GBrain MCP control requests failed");
    return {
      status: statusRead.ok ? statusRead.value : null,
      recentJobs: jobsRead.ok ? jobsRead.value as unknown[] : null,
      fullRuns: fullRunsRead.ok ? fullRunsRead.value as unknown[] : null,
      globalRuns: globalRunsRead.ok ? globalRunsRead.value as unknown[] : null,
      partial: reads.some((result) => !result.ok),
    };
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
