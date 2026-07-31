import { join } from "node:path";
import { AuthService } from "./auth";
import { loadConfig } from "./config";
import { ControlActionService } from "./control-actions";
import { ControlCenterService } from "./control-center";
import { createDb } from "./db";
import { GraphService } from "./graph";
import { createHttpHandler } from "./http";

const config = loadConfig();
const sql = createDb(config);
const graph = new GraphService(sql, config);
await graph.initialize();
const auth = new AuthService(config.auth);
const controlCenter = new ControlCenterService(config.controlCenter, config.allowedSourceIds);
const controlActions = new ControlActionService(config.controlCenter, config.allowedSourceIds);
const handler = createHttpHandler({
  config,
  graph,
  auth,
  controlCenter,
  controlActions,
  distPath: join(process.cwd(), "dist"),
  environment: process.env.NODE_ENV,
});

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch(request, bunServer) {
    const socket = bunServer.requestIP(request);
    return handler(request, { address: socket?.address ?? null });
  },
});

console.log(`GBrain API listening on http://${server.hostname}:${server.port}`);
graph.startRebuild();

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.stop(false);
  await Promise.allSettled([graph.close(), sql.end(), controlCenter.close(), controlActions.close()]);
  process.exit(0);
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
