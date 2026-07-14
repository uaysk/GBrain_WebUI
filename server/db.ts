import postgres, { type Sql } from "postgres";
import type { Config } from "./config";

export function createDb(config: Config): Sql {
  return postgres({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.user,
    password: config.db.password,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 8,
    connection: { application_name: "gbrain-3d-memory-map", default_transaction_read_only: true },
    onnotice: () => undefined,
  });
}
