#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
umask 077
exec bun "${project_root}/scripts/graphify-hybrid/launch.ts" mcp
