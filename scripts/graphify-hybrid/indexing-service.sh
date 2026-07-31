#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly project_root="/home/uaysk/GBrain_WebUI"
readonly project_key="gbrain-webui"
readonly state_dir="/home/uaysk/.local/state/gbrain-webui-graphify"

mkdir -p "${state_dir}"
exec 9>"${state_dir}/indexing.lock"
if ! flock -n 9; then
  printf '[gbrain-webui-graphify] another indexing job owns the lock\n'
  exit 0
fi

index_input_hash() {
  (
    cd "${project_root}"
    bun scripts/graphify-hybrid/input-hash.ts \
      graphify-out/graph.json \
      . \
      "${project_key}"
  )
}

verify_index() {
  local status_json
  status_json="$(
    cd "${project_root}"
    scripts/graphify-hybrid/run.sh status --project "${project_key}"
  )"
  node -e '
    const fs = require("node:fs");
    const graph = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const status = JSON.parse(process.argv[2]);
    const expected = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const latest = Number(status.latestRun?.node_count ?? -1);
    const indexed = Number(status.index?.count ?? -1);
    const fresh = status.freshness?.fresh === true;
    if (latest !== expected || indexed !== expected || !fresh) {
      console.error(`[gbrain-webui-graphify] verification failed: expected=${expected}, latest=${latest}, indexed=${indexed}, fresh=${fresh}`);
      process.exit(1);
    }
    console.log(`[gbrain-webui-graphify] verified ${expected} indexed nodes`);
  ' "${project_root}/graphify-out/graph.json" "${status_json}"
}

marker="${state_dir}/input.sha256"
current_hash="$(index_input_hash)"
if [[ -f "${marker}" ]] && [[ "$(tr -d '\n' < "${marker}")" == "${current_hash}" ]]; then
  if verify_index; then
    printf '[gbrain-webui-graphify] graph, source snippets, and index are already current\n'
    exit 0
  fi
fi

cd "${project_root}"
scripts/graphify-hybrid/run.sh index \
  --project "${project_key}" \
  --batch-size=64 \
  --concurrency=4
verify_index
graphify global add graphify-out/graph.json --as "${project_key}"

marker_tmp="${marker}.tmp.$$"
printf '%s\n' "${current_hash}" > "${marker_tmp}"
mv "${marker_tmp}" "${marker}"
printf '[gbrain-webui-graphify] indexing, verification, and global graph registration completed\n'
