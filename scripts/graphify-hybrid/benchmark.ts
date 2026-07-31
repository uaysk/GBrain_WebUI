import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { apiConfigFromEnv } from "./config.js";
import { loadGraphArtifact } from "./documents.js";
import { hybridRetrieve, lexicalRank, rerank } from "./ranking.js";
import type { RankedNode } from "./types.js";

type BenchmarkCase = { question: string; expected: string[]; kind: "exact" | "semantic" };

export const BENCHMARK_CASES: BenchmarkCase[] = [
  { question: "GraphService", expected: ["server_graph_graphservice"], kind: "exact" },
  { question: "ControlCenterService", expected: ["server_control_center_controlcenterservice"], kind: "exact" },
  { question: "ControlActionService", expected: ["server_control_actions_controlactionservice"], kind: "exact" },
  { question: "detectLeidenCommunities", expected: ["server_community_detectleidencommunities"], kind: "exact" },
  { question: "createMap2DLayout", expected: ["src_graph_layout_2d_createmap2dlayout"], kind: "exact" },
  { question: "재빌드 상태와 스냅샷 가용성을 반환하는 메서드", expected: ["server_graph_graphservice_getrebuildstatus"], kind: "semantic" },
  { question: "현재 실행 중인 source job을 검사하는 함수", expected: ["server_control_actions_activesourcejob"], kind: "semantic" },
  { question: "제어 센터 전체 응답 데이터 계약", expected: ["shared_contracts_index_controlcenterresponse"], kind: "semantic" },
  { question: "Leiden 알고리즘으로 메모리 커뮤니티를 탐지하는 함수", expected: ["server_community_detectleidencommunities"], kind: "semantic" },
  { question: "3D 노드 선택 상태에 따라 렌더링 객체를 만드는 함수", expected: ["src_graph_rendering_createnodeobject"], kind: "semantic" },
  { question: "시간에 따른 그래프 노드 상태를 투영하는 함수", expected: ["src_graph_graph_timeline_projectgraphatframe"], kind: "semantic" },
  { question: "2D 메모리 지도 레이아웃을 생성하는 함수", expected: ["src_graph_layout_2d_createmap2dlayout"], kind: "semantic" },
];

function rankOf(ids: string[], expected: string[]): number | null {
  const index = ids.findIndex((id) => expected.includes(id));
  return index < 0 ? null : index + 1;
}

function metrics(ranks: Array<number | null>) {
  const recall = (k: number) => ranks.filter((rank) => rank !== null && rank <= k).length / ranks.length;
  const mrr = ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length;
  return { recallAt1: recall(1), recallAt5: recall(5), recallAt10: recall(10), mrr };
}

export async function benchmarkFingerprint(graphPath: string): Promise<string> {
  const config = apiConfigFromEnv({ cache: true });
  const artifact = await loadGraphArtifact(graphPath);
  return createHash("sha256").update(JSON.stringify({
    graphSha: artifact.graphSha,
    embeddingModel: config.embeddingModel,
    rerankerModel: config.rerankerModel,
    cases: BENCHMARK_CASES,
  })).digest("hex");
}

export async function runBenchmark(input: {
  graphPath: string;
  project: string;
  output?: string;
  onProgress?: (done: number, total: number, kind: BenchmarkCase["kind"]) => void;
}) {
  const graph = (await loadGraphArtifact(input.graphPath)).graph;
  const rows: Array<{
    question: string;
    kind: string;
    lexicalRank: number | null;
    hybridRank: number | null;
    rerankedRank: number | null;
  }> = [];
  for (const test of BENCHMARK_CASES) {
    const lexical = lexicalRank(graph, test.question, 50);
    const hybrid = await hybridRetrieve({
      question: test.question,
      graphPath: input.graphPath,
      project: input.project,
      topK: 50,
      seedCount: 10,
      depth: 0,
      useReranker: false,
    });
    const preRerankIds = hybrid.seeds.map((seed) => seed.nodeId);
    const rerankCandidates: RankedNode[] = hybrid.seeds;
    const reranked = await rerank(test.question, rerankCandidates, rerankCandidates.length);
    rows.push({
      question: test.question,
      kind: test.kind,
      lexicalRank: rankOf(lexical.map((row) => row.nodeId), test.expected),
      hybridRank: rankOf(preRerankIds, test.expected),
      rerankedRank: rankOf(reranked.map((row) => row.nodeId), test.expected),
    });
    input.onProgress?.(rows.length, BENCHMARK_CASES.length, test.kind);
  }
  const report = {
    fingerprint: await benchmarkFingerprint(input.graphPath),
    cases: rows,
    lexical: metrics(rows.map((row) => row.lexicalRank)),
    hybridBeforeReranker: metrics(rows.map((row) => row.hybridRank)),
    hybridAfterReranker: metrics(rows.map((row) => row.rerankedRank)),
    semanticOnly: {
      lexical: metrics(rows.filter((row) => row.kind === "semantic").map((row) => row.lexicalRank)),
      hybridBeforeReranker: metrics(rows.filter((row) => row.kind === "semantic").map((row) => row.hybridRank)),
      hybridAfterReranker: metrics(rows.filter((row) => row.kind === "semantic").map((row) => row.rerankedRank)),
    },
  };
  if (input.output) await writeFile(input.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
