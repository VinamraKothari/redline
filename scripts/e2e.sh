#!/usr/bin/env bash
# Builds the app, serves the fixture site and runs the Playwright suite.
set -euo pipefail
cd "$(dirname "$0")/.."
ps aux | grep -E "next-server|next build" | grep -v grep | awk "{print \$2}" | xargs -r kill 2>/dev/null || true
pkill -f "http.server 3999" 2>/dev/null || true
rm -rf .data
npm run build >/tmp/redline-build.log 2>&1 || { tail -40 /tmp/redline-build.log; exit 1; }
(cd tests/fixtures && python3 -m http.server 3999 >/tmp/fixture.log 2>&1 &)
PORT=3123 REDLINE_ALLOW_LOCAL=1 REDLINE_TEST_AUTH=1 npm run start >/tmp/redline-server.log 2>&1 &
sleep 4
PW_CHROMIUM="${PW_CHROMIUM:-}" npx playwright test "$@"
