#!/usr/bin/env bash
# Throughline — architectural layer boundary enforcement.
#
# The semantic layer is only real if it cannot be bypassed. Application code
# queries sem.* exclusively; core.* and raw.* belong to repos and ingest.
# ESLint covers the TS/TSX cases; this grep is the backstop that also catches
# raw SQL in template literals and any file type ESLint does not parse.
# See docs/architecture.md and CLAUDE.md.

set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
scan() {
  local label="$1" pattern="$2"; shift 2
  local dirs=() d
  for d in "$@"; do [ -d "$d" ] && dirs+=("$d"); done
  [ "${#dirs[@]}" -eq 0 ] && return 0
  local hits
  hits=$(grep -rInE "$pattern" "${dirs[@]}" \
    --include='*.ts' --include='*.tsx' --include='*.sql' \
    --exclude-dir=node_modules --exclude-dir=.next 2>/dev/null \
    | grep -v 'layers-ok' || true)
  if [ -n "$hits" ]; then
    echo "check-layers: FAIL — $label"
    printf '%s\n' "$hits"
    echo
    FAIL=1
  fi
}

scan "application code referenced core.* or raw.* (use sem.* via src/server/repos/)" \
     '\b(core|raw)\.[a-z_]+' src/app src/components src/actions

scan "user-scoped table touched outside a withUser() transaction boundary" \
     'usr\.[a-z_]+' src/app src/components

if [ "$FAIL" -eq 0 ]; then echo "check-layers: OK"; fi
exit "$FAIL"
