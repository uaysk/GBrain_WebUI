#!/usr/bin/env bash
set -euo pipefail

readonly project_root="/home/uaysk/GBrain_WebUI"
readonly project_key="gbrain-webui"
readonly state_dir="/home/uaysk/.local/state/gbrain-webui-graphify"
readonly graph_path="${project_root}/graphify-out/graph.json"
readonly report_path="${project_root}/graphify-out/hybrid-benchmark.json"

umask 077
mkdir -p "${state_dir}"
exec 9>"${state_dir}/benchmark.lock"
if ! flock -n 9; then
  printf '[gbrain-webui-graphify] another benchmark owns the lock\n'
  exit 0
fi

fingerprint="$(cd "${project_root}" && bun scripts/graphify-hybrid/benchmark-fingerprint.ts "${graph_path}" "${project_root}")"
marker="${state_dir}/benchmark.sha256"
if [[ -f "${marker}" ]] \
  && [[ -f "${report_path}" ]] \
  && [[ "$(tr -d '\n' < "${marker}")" == "${fingerprint}" ]]; then
  printf '[gbrain-webui-graphify] benchmark graph/model/cases fingerprint is current\n'
  exit 0
fi

report_tmp="${report_path}.tmp.$$"
marker_tmp="${marker}.tmp.$$"
cd "${project_root}"
scripts/graphify-hybrid/run.sh benchmark \
  --project "${project_key}" \
  --graph "${graph_path}" \
  --out "${report_tmp}"
mv "${report_tmp}" "${report_path}"
printf '%s\n' "${fingerprint}" > "${marker_tmp}"
mv "${marker_tmp}" "${marker}"
printf '[gbrain-webui-graphify] benchmark completed for current graph/model/cases fingerprint\n'
