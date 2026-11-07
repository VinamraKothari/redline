#!/usr/bin/env bash
# Reads bug threads from a Redline deployment's agent API (docs/agent-api.md).
#
#   bash scripts/bugs.sh                 open threads
#   bash scripts/bugs.sh all|resolved    by status
#   bash scripts/bugs.sh <thread id>     one thread
#
# Needs REDLINE_AGENT_URL and REDLINE_AGENT_TOKEN, from the environment or .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

# read KEY=value from .env.local without executing it as shell
fromenv() { [ -f .env.local ] && grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g' || true; }
URL="${REDLINE_AGENT_URL:-$(fromenv REDLINE_AGENT_URL)}"
TOKEN="${REDLINE_AGENT_TOKEN:-$(fromenv REDLINE_AGENT_TOKEN)}"
[ -n "$URL" ] && [ -n "$TOKEN" ] || { echo "Set REDLINE_AGENT_URL and REDLINE_AGENT_TOKEN (env or .env.local)." >&2; exit 1; }

arg="${1:-open}"
case "$arg" in
  open|resolved|all) path="/api/agent/bugs?status=$arg" ;;
  *) path="/api/agent/bugs/$arg" ;;
esac

# the token goes through a header file on stdin so it never shows up in `ps`
out=$(curl -sS --fail-with-body -H @- "${URL%/}$path" <<<"Authorization: Bearer $TOKEN") || { echo "$out" >&2; exit 1; }
if command -v jq >/dev/null; then jq . <<<"$out"; else echo "$out"; fi
