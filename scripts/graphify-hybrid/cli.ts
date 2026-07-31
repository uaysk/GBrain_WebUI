#!/usr/bin/env node
import { parseCliArgs } from "./cli-options.js";
import { runBenchmark } from "./benchmark.js";
import { apiConfigFromEnv } from "./config.js";
import {
  closeSharedDatabasePool,
  createDatabaseClient,
  setupSchema,
} from "./database.js";
import { buildRetrievalInput } from "./documents.js";
import { indexGraph, indexStatus } from "./indexer.js";
import { hybridRetrieve } from "./ranking.js";
import { synthesizeWithModel } from "./synthesis.js";

export async function runCli(args: string[]): Promise<void> {
  const options = parseCliArgs(args);
  try {
    if (options.command === "setup") {
      const client = createDatabaseClient();
      await client.connect();
      try {
        await setupSchema(client);
      } finally {
        await client.end();
      }
      console.log(JSON.stringify({ ok: true }));
      return;
    }
    if (options.command === "index") {
      const result = await indexGraph({
        graphPath: options.graph,
        root: options.root,
        project: options.project,
        graphSha: options.sha,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        onProgress(done, total, reused) {
          if (done === total || done % 256 === 0) {
            process.stderr.write(`[graphify-hybrid] embedded ${done}/${total}; reused ${reused}\n`);
          }
        },
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (options.command === "query") {
      const retrieval = await hybridRetrieve({
        question: options.question,
        graphPath: options.graph,
        project: options.project,
        topK: options.topK,
        seedCount: options.seedCount,
        depth: options.depth,
        contextFilters: options.contextFilters,
        useReranker: options.useReranker,
      });
      const result = options.synthesize
        ? { ...retrieval, synthesis: await synthesizeWithModel(retrieval) }
        : retrieval;
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (options.command === "benchmark") {
      const report = await runBenchmark({
        graphPath: options.graph,
        project: options.project,
        output: options.output,
        onProgress(done, total, kind) {
          process.stderr.write(`[benchmark] ${done}/${total} ${kind}\n`);
        },
      });
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const config = apiConfigFromEnv({ cache: true });
    const current = await buildRetrievalInput({
      graphPath: options.graph,
      root: options.root,
      project: options.project,
      embeddingModel: config.embeddingModel,
    });
    console.log(JSON.stringify(
      await indexStatus(options.project, current.retrievalInputHash),
      null,
      2,
    ));
  } finally {
    await closeSharedDatabasePool();
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
