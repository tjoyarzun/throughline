#!/usr/bin/env bash
# Seeds the PRODUCTION Neon database.
#
# Why this is not automated: Vercel marks environment variables as Sensitive,
# so their values cannot be read back — `vercel env pull` returns [SENSITIVE]
# placeholders. That is the platform protecting the credentials correctly, and
# a ~30 minute, ~10,000-request ingest cannot run inside a serverless function
# anyway. So it runs from a machine that has the connection string.
#
# SETUP (once):
#   1. Neon console -> your project -> Connection Details
#   2. Copy the DIRECT connection string (NOT pooled — DDL and long
#      transactions are unreliable through pgbouncer)
#   3. Write it to .env.production.local:
#        DATABASE_URL=<direct connection string>
#        DATABASE_URL_UNPOOLED=<same direct connection string>
#        TMDB_READ_ACCESS_TOKEN=<your v4 read token>
#
#   .env.production.local is gitignored.
#
# RUN:  bash scripts/seed-production.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.production.local ]; then
  echo "seed-production: .env.production.local not found. See the header of this script." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
. ./.env.production.local
set +a

: "${DATABASE_URL:?DATABASE_URL must be set in .env.production.local}"
: "${TMDB_READ_ACCESS_TOKEN:?TMDB_READ_ACCESS_TOKEN must be set in .env.production.local}"

HOST=$(node -e "console.log(new URL(process.env.DATABASE_URL.replace(/^postgres/, 'http')).hostname)")
case "$HOST" in
  localhost|127.0.0.1)
    echo "seed-production: DATABASE_URL points at $HOST — that is not production. Aborting." >&2
    exit 1 ;;
esac

echo "seed-production: target $HOST"
echo "  This ingests ~5,000 titles and takes roughly 30 minutes."
echo "  It is idempotent and resumable: re-running resolves existing titles cheaply."
echo

echo "[1/4] applying migrations"
pnpm db:migrate

echo "[2/4] seeding the corpus"
pnpm seed

echo "[3/4] deriving themes from the crosswalk"
pnpm derive:themes

echo "[4/4] enriching from Wikidata"
pnpm enrich:wikidata

echo
echo "seed-production: done. Check https://throughline-mu-seven.vercel.app/api/health"
