#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

control_token="${GBRAIN_CONTROL_MCP_TOKEN:-${GBRAIN_REMOTE_TOKEN:-}}"

if [[ ${#control_token} -lt 32 ]]; then
  echo "Set GBRAIN_REMOTE_TOKEN (or GBRAIN_CONTROL_MCP_TOKEN) to a valid GBrain MCP bearer token" >&2
  exit 1
fi

export GBRAIN_CONTROL_MCP_URL="${GBRAIN_CONTROL_MCP_URL:-https://gbrain.uaysk.com/mcp}"
export GBRAIN_CONTROL_MCP_TOKEN="$control_token"
export GBRAIN_CONTROL_MUTATIONS_ENABLED="${GBRAIN_CONTROL_MUTATIONS_ENABLED:-true}"
export APP_CONTROL_CENTER_REQUEST_TIMEOUT_SECONDS="${APP_CONTROL_CENTER_REQUEST_TIMEOUT_SECONDS:-10}"
export APP_CONTROL_CENTER_CACHE_SECONDS="${APP_CONTROL_CENTER_CACHE_SECONDS:-10}"
export APP_CONTROL_ACTION_LEDGER_PATH="${APP_CONTROL_ACTION_LEDGER_PATH:-/app-data/control-actions.json}"

if [[ "$GBRAIN_CONTROL_MCP_URL" == http://host.docker.internal:* ]]; then
  export GBRAIN_CONTROL_ALLOW_INSECURE_HTTP="${GBRAIN_CONTROL_ALLOW_INSECURE_HTTP:-true}"
else
  export GBRAIN_CONTROL_ALLOW_INSECURE_HTTP="${GBRAIN_CONTROL_ALLOW_INSECURE_HTTP:-false}"
fi

cleanup() {
  unset control_token GBRAIN_CONTROL_MCP_TOKEN
}
trap cleanup EXIT

cd "$project_root"
docker compose up --build -d web

container_id="$(docker compose ps -q web)"
if [[ -z "$container_id" ]]; then
  echo "Web container was not created" >&2
  exit 1
fi

health_ready=false
for _ in {1..45}; do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  if [[ "$health" == "healthy" ]]; then
    health_ready=true
    break
  fi
  if [[ "$health" == "unhealthy" || "$health" == "exited" || "$health" == "dead" ]]; then
    echo "GBrain WebUI deployment entered terminal state: $health" >&2
    exit 1
  fi
  sleep 2
done

if [[ "$health_ready" != "true" ]]; then
  echo "Timed out waiting for GBrain WebUI healthcheck" >&2
  exit 1
fi

docker exec "$container_id" bun -e '
  const base = "http://127.0.0.1:3000";
  const password = process.env.APP_AUTH_PASSWORD ?? "";
  if (!password) throw new Error("APP_AUTH_PASSWORD is missing");
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, next: "/control" }),
    redirect: "manual",
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const response = await fetch(`${base}/api/control-center?refresh=1`, { headers: { Cookie: cookie } });
  const data = await response.json();
  const managementExpected = (process.env.GBRAIN_CONTROL_MUTATIONS_ENABLED ?? "").toLowerCase() === "true";
  const complete = login.status === 303
    && response.status === 200
    && data?.availability?.configured === true
    && data?.availability?.connected === true
    && data?.availability?.message === null
    && typeof data?.version === "string"
    && Array.isArray(data?.sources)
    && Array.isArray(data?.jobs)
    && data?.management?.enabled === managementExpected;
  if (!complete) throw new Error("Control Center MCP verification failed");
  console.log(`Control Center MCP verified (version=${data.version}, sources=${data.sources.length}, jobs=${data.jobs.length})`);
'

echo "GBrain WebUI deployment is healthy and Control MCP is connected"
