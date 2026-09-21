#!/usr/bin/env bash
# Throughline — American English (en-US) enforcement.
#
# WHY THIS EXISTS: cspell alone cannot catch this. "colour" and "normalisation" are
# valid dictionary words, so a spell checker passes them. Locale drift needs a denylist.
# The first draft of docs/ was written in British English; this is the check that
# would have caught it. See docs/adr/0013-en-us-locale-enforcement.md.
#
# Usage:
#   scripts/check-locale.sh              scan the default source globs
#   scripts/check-locale.sh <path>...    scan specific paths (used by the test suite)
#
# Exceptions (do NOT "correct" these) are handled two ways:
#   1. .localeignore — one extended-regex per line; matching lines are exempt.
#   2. An inline `locale-ok` comment anywhere on the line exempts that line.
# Provider field names, quoted titles, and proper nouns belong in .localeignore.

set -uo pipefail
cd "$(dirname "$0")/.."

# -- British -ise/-isation stems (the American form uses -ize/-ization) -------
STEMS='organis|recognis|realis|apologis|emphasis[ei]|specialis|standardis|categoris|characteris'
STEMS="$STEMS|generalis|initialis|finalis|personalis|prioritis|summaris|utilis|minimis|maximis"
STEMS="$STEMS|optimis|normalis|serialis|visualis|materialis|penalis|authoris|localis|monetis"
STEMS="$STEMS|parameteris|synchronis|sanitis|randomis|tokenis|modernis|digitis|centralis"
STEMS="$STEMS|rationalis|stabilis|legitimis|harmonis|customis|itemis|memoris|criticis|civilis"
STEMS="$STEMS|colonis|familiaris|hypothesis[ei]|mobilis|computeris|containeris|factoris|formalis"
STEMS="$STEMS|globalis|industrialis|marginalis|modularis|neutralis|publicis|analys|paralys|catalys"
# A leading [a-z]* is required, not optional polish: anchoring the stem at a
# word boundary misses every prefixed form. `unrecognised` slipped through the
# first version of this check and reached a commit.
STEM_RE="\\b[a-z]*(${STEMS})(e|es|ed|ing|ation|ations|able|ability|er|ers)?\\b"

# -- Literal British forms ---------------------------------------------------
WORDS='colour|colours|coloured|colouring|colourful|behaviour|behaviours|behavioural'
WORDS="$WORDS|favour|favours|favoured|favouring|favourite|favourites|honour|honours|honoured"
WORDS="$WORDS|labour|labours|neighbour|neighbours|neighbouring|rumour|humour|endeavour|flavour"
WORDS="$WORDS|harbour|armour|vapour|odour|parlour|saviour|valour|vigour|splendour"
WORDS="$WORDS|centre|centres|centred|centring|metre|metres|litre|litres|theatre|theatres"
WORDS="$WORDS|fibre|fibres|calibre|sombre|lustre|spectre|meagre|manoeuvre|manoeuvres"
WORDS="$WORDS|defence|defences|offence|offences|licence|licences|pretence|practise|practised"
WORDS="$WORDS|modelling|modelled|labelling|labelled|cancelling|cancelled|travelling|traveller"
WORDS="$WORDS|signalling|signalled|fuelling|fuelled|marvellous|jewellery|levelled|totalled"
WORDS="$WORDS|dialled|equalled|programme|programmes|catalogue|catalogues|catalogued"
WORDS="$WORDS|grey|greyed|ageing|judgement|judgements|acknowledgement|acknowledgements"
WORDS="$WORDS|whilst|amongst|learnt|spelt|dreamt|enquire|enquiry|enquiries|speciality|specialities"
WORDS="$WORDS|storey|storeys|kerb|tyre|tyres|plough|draught|mould|moulded|smoulder"
WORDS="$WORDS|aluminium|sulphur|cheque|cheques|sceptic|sceptical|scepticism"
WORD_RE="\\b(${WORDS})\\b"

DEFAULT_PATHS=(src docs ontology scripts drizzle tests CLAUDE.md README.md)
if [ "$#" -gt 0 ]; then TARGETS=("$@"); SCOPED=1; else TARGETS=("${DEFAULT_PATHS[@]}"); SCOPED=0; fi

EXISTING=()
for t in "${TARGETS[@]}"; do [ -e "$t" ] && EXISTING+=("$t"); done
[ "${#EXISTING[@]}" -eq 0 ] && { echo "check-locale: no targets found"; exit 0; }

RAW=$(grep -rInE "${STEM_RE}|${WORD_RE}" "${EXISTING[@]}" \
        --include='*.ts' --include='*.tsx' --include='*.md' --include='*.css' \
        --include='*.yaml' --include='*.yml' --include='*.sh' --include='*.json' \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
        ${SCOPED:+} 2>/dev/null || true)

# This script necessarily contains the denylist itself; never scan it.
RAW=$(printf '%s\n' "$RAW" | grep -v '^scripts/check-locale\.sh:' || true)
# Fixtures exist to fail the check on purpose; only the test harness targets them.
[ "$SCOPED" -eq 0 ] && RAW=$(printf '%s\n' "$RAW" | grep -v '^tests/fixtures/locale-' || true)
# Inline exemption marker.
RAW=$(printf '%s\n' "$RAW" | grep -v 'locale-ok' || true)
# Project exception allowlist.
if [ -s .localeignore ]; then
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    case "$pat" in \#*) continue ;; esac
    RAW=$(printf '%s\n' "$RAW" | grep -vE "$pat" || true)
  done < .localeignore
fi

HITS=$(printf '%s\n' "$RAW" | grep -c . || true)
if [ "$HITS" -gt 0 ]; then
  echo "check-locale: FAIL — ${HITS} line(s) with British spellings found. This project is en-US."
  echo
  printf '%s\n' "$RAW"
  echo
  echo "Fix the spelling, or if it is a genuine exception (provider field name, quoted"
  echo "title, proper noun) add a regex to .localeignore or append a 'locale-ok' comment."
  exit 1
fi
echo "check-locale: OK — no British spellings in ${EXISTING[*]}"
