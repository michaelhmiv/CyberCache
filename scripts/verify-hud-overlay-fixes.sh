#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIORAMA="$ROOT/src/components/dashboard/LiveTurfDiorama.tsx"
STAT_BAR="$ROOT/src/components/stats/CharacterStatBar.tsx"
DASHBOARD="$ROOT/src/screens/DashboardScreen.tsx"
HOOK="$ROOT/src/hooks/useSyncSurvivalMaxHp.ts"

failures=0
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }

if grep -Fq "key={\`weapon-\${weapon?.id ?? 'fallback'}\`}" "$DIORAMA"; then
  pass "LiveTurfDiorama weapon key is stable across tick events"
else
  fail "LiveTurfDiorama weapon key must depend on weapon id, not latestEvent/eventActive/mode"
fi

if grep -Fq 'key={`weapon-${eventActive' "$DIORAMA" || grep -Fq 'key={`weapon-${latestEvent' "$DIORAMA" || grep -Fq 'key={`weapon-${mode' "$DIORAMA"; then
  fail "LiveTurfDiorama weapon key still includes tick/event state"
else
  pass "LiveTurfDiorama weapon key does not include tick/event state"
fi

if grep -Fq "useMemo<CharacterStatSummary>" "$DIORAMA" && grep -Fq "buildCharacterStatSummary" "$DIORAMA"; then
  pass "LiveTurfDiorama memoizes Hunter Totals stat summary"
else
  fail "LiveTurfDiorama must memoize buildCharacterStatSummary for HUD overlay stability"
fi

if grep -Fq "export const CharacterStatBar = memo" "$STAT_BAR" && grep -Fq "const MiniMetric = memo" "$STAT_BAR" && grep -Fq "const TopContribsStrip = memo" "$STAT_BAR"; then
  pass "CharacterStatBar and HUD subcomponents are memoized"
else
  fail "CharacterStatBar/HUD subcomponents should be wrapped in React.memo"
fi

if grep -Fq "will-change-transform" "$STAT_BAR"; then
  pass "Hunter Totals overlay is promoted to its own compositor layer"
else
  fail "Hunter Totals overlay should include will-change-transform"
fi

if [[ -f "$HOOK" ]] && grep -Fq "recomputeMaxHp" "$HOOK" && grep -Fq "useSyncSurvivalMaxHp" "$DASHBOARD"; then
  pass "Dashboard syncs survival maxHp from loadout stats"
else
  fail "Dashboard should call useSyncSurvivalMaxHp so HP chip and stat strip agree"
fi

if (( failures > 0 )); then
  printf '\n%d HUD overlay regression check(s) failed.\n' "$failures" >&2
  exit 1
fi

printf '\nAll HUD overlay regression checks passed.\n'
