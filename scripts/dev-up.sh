#!/usr/bin/env bash
# One-command local startup for HostPog (macOS / Linux).
#   ./scripts/dev-up.sh            install, start Docker services, migrate, smoke-test PostHog (if a key is set), run dev servers
#   ./scripts/dev-up.sh --no-smoke skip the PostHog smoke test
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf "\n\033[1m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[31m✘ %s\033[0m\n" "$*"; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || fail "Node.js 22+ is required (https://nodejs.org)"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || fail "Node.js 22+ is required (found $(node -v))"
command -v docker >/dev/null || fail "Docker is required (Docker Desktop)"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker Desktop and retry."
if ! command -v pnpm >/dev/null; then
  echo "pnpm not found — enabling it via corepack"
  corepack enable && corepack prepare pnpm@10.20.0 --activate
fi
[ -f .env ] || fail ".env is missing. Copy .env.example to .env and set HOSTPOG_MASTER_KEY and BETTER_AUTH_SECRET."
grep -q '^HOSTPOG_MASTER_KEY=.\+' .env || fail "HOSTPOG_MASTER_KEY is empty in .env (openssl rand -base64 32)"
grep -q '^BETTER_AUTH_SECRET=.\+' .env || fail "BETTER_AUTH_SECRET is empty in .env (openssl rand -base64 32)"

step "Checking ports"
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
for pair in "POSTGRES_PORT:5433" "CLICKHOUSE_HTTP_PORT:8123" "REDIS_PORT:6379" "WEB:3000" "INGEST_PORT:3001"; do
  name=${pair%%:*}; port=$(envval "$name"); port=${port:-${pair##*:}}
  owner=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(0\.0\.0\.0|127\.0\.0\.1|\[::\]):${port}->" | awk '{print $1}' | grep -v '^hostpog-' | head -1 || true)
  if [ -n "$owner" ]; then
    fail "Port $port ($name) is already used by the Docker container '$owner'. Set a free port for $name in .env (and update the matching URL), or stop that container."
  fi
  if [ -z "$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E ":${port}->" | grep '^hostpog-')" ] && command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "⚠ Port $port ($name) is in use by another process: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN | awk 'NR==2{print $1" (pid "$2")"}')"
  fi
done

step "Installing dependencies"
pnpm install

step "Starting Postgres, ClickHouse and Redis (Docker)"
pnpm infra:up

step "Applying database migrations"
pnpm db:migrate

if [ "${1:-}" != "--no-smoke" ] && grep -q '^POSTHOG_SMOKE_API_KEY=.\+' .env; then
  step "Read-only PostHog smoke test"
  pnpm posthog:smoke || echo "⚠ PostHog smoke test reported problems (see above). The app still starts."
fi

step "Starting HostPog — web http://localhost:3000 · ingest http://localhost:3001 (Ctrl+C to stop)"
exec pnpm dev
