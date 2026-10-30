#!/usr/bin/env bash
# Architecture guard — catches forbidden patterns in screens and components.
#
# Run from repo root: bash scripts/guard-architecture.sh
#
# This guard catches the class of mistakes that caused the active-roaming
# blank-screen bug: screen-level reward engines, duplicate type unions,
# and direct gameplay mutations from UI code.
#
# Exit 0 = clean, exit 1 = violations found.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VIOLATIONS=0
SRC="src"

# Files to scan for screen/component violations
SCREENS="$SRC/screens"
COMPONENTS="$SRC/components"

# Allowed files for gameplay mutations (domain stores, RPC clients, sims)
# Format: "filepath:reason"
ALLOWED_MUTATIONS=(
  "$SRC/store/slices/playerSlice.ts:domain owner for player resources"
  "$SRC/store/slices/inventorySlice.ts:domain owner for inventory"  
  "$SRC/store/slices/idleTickerSlice.ts:single ticker (preview-only, no item gen)"
  "$SRC/server/chef.ts:Chef worker — authoritative engine"
  "$SRC/server/routes/claim.ts:Chef API routes"
  "$SRC/store/slices/survivalSlice.ts:domain owner for survival HP"
  "$SRC/store/slices/killCycleSlice.ts:domain owner for kill cycle"
  "$SRC/lib/activity/activitySettlement.ts:offline settlement bridge"
  "$SRC/lib/api/verifiedOps.ts:RPC client wrapper"
  "$SRC/lib/generators/:gear generation utilities"
  "$SRC/lib/combat/:pure combat math (no side effects in screens)"
  "$SRC/lib/simulation/bossSimulator.ts:pure boss simulation"
  "$SRC/content/simulation.ts:XP curve / loot sim"
  "$SRC/lib/chef/chefClient.ts:Chef API client (no gameplay mutations)"
  "$SRC/test/:test files"
  # Screens/components with legitimate user-initiated mutations (not tick engines):
  "$SRC/screens/WorkshopScreen.tsx:workshop refunds (user cancels craft)"
  "$SRC/screens/MarketScreen.tsx:market buy/sell (user transaction)"
  "$SRC/screens/GearYardScreen.tsx:salvage (user breaks down gear)"
  "$SRC/screens/LootScreen.tsx:salvage (user breaks down gear)"
  "$SRC/components/action/DeathOverlay.tsx:user resurrection intent (calls the Chef resurrect op; no local economy mutation since Phase 0 Slice 4)"
)

# Allowed files for Math.random in gameplay contexts
ALLOWED_RANDOM=(
  "$SRC/store/slices/idleTickerSlice.ts:client-preview rolls (server-verified)"
  "$SRC/lib/simulation/bossSimulator.ts:boss attempt simulation"
  "$SRC/lib/combat/:combat damage variation"
  "$SRC/lib/generators/:seed generation for gear"
  "$SRC/lib/activity/activitySettlement.ts:offline settlement rolls"
  "$SRC/lib/pixelArt/:cosmetic particle effects"
  "$SRC/lib/run/runEvents.ts:event ID generation (display-only)"
  "$SRC/test/:test files"
  "$SRC/screens/MarketScreen.tsx:UI ID generation (non-gameplay)"
)

# Allowed setInterval/setTimeout in screens/components
ALLOWED_TIMERS=(
  "$SRC/screens/ActionScreenContextual.tsx:display-only elapsed timer + heartbeat"
  "$SRC/screens/WorkshopScreen.tsx:display-only clock + craft toast"
  "$SRC/screens/MarketScreen.tsx:toast dismissal timer"
  "$SRC/screens/DashboardScreen.tsx:no setInterval (uses tickFeed store)"
  "$SRC/components/action/DeathOverlay.tsx:resurrection countdown timer (display-only)"
  "$SRC/components/action/SalvageToast.tsx:toast dismissal timer"
  "$SRC/components/action/SwapUndoToast.tsx:toast auto-dismiss timer (display-only)"
  "$SRC/components/activity/SettlementDebugOverlay.tsx:debug overlay display clock"
  "$SRC/components/stats/ActiveBuffPills.tsx:buff countdown display clock (display-only)"
  "$SRC/components/activity/useLeaveSignals.ts:best-effort leave signal throttle reset"
  "$SRC/components/fight/BossPrepModal.tsx:fight animation delay (display-only)"
  "$SRC/components/pixelArt/LootMoment.tsx:loot celebration pacing (display-only; advances presentation state, drops already awarded)"
  "$SRC/components/profile/UsernameSetupModal.tsx:username availability debounce (form validation)"
  "$SRC/hooks/useNow.ts:shared reactive clock hook"
  "$SRC/lib/activity/useActionStageOrchestrator.ts:animation beat pacing (display-only)"
  "$SRC/lib/animation/fightTimeline.ts:animation phase timing (display-only)"
  "$SRC/store/runtimeSupabaseSync.ts:debounced save timer"
  "$SRC/test/:test files"
)

is_allowed() {
  local file="$1"
  shift
  local allowed_list=("$@")
  for entry in "${allowed_list[@]}"; do
    local prefix="${entry%%:*}"
    if [[ "$file" == $prefix ]]; then
      return 0
    fi
  done
  return 1
}

echo -e "${YELLOW}=== CyberCache Architecture Guard ===${NC}"
echo ""

# Rule 1: No reward mutation calls in screens/components
echo -n "Rule 1: No reward mutations in screens/components... "
REWARD_CALLS=(
  "addCredits"
  "addXP"
  "addScrap"
  "addMaterial"
  "addEssence"
  "addCacheKeyFragments"
  "addItem"
  "generateAndAdd"
  "generateAndAddWeapon"
  "generateAndAddShield"
  "generateAndAddOrdnance"
  "generateAndAddClassMod"
  "generateAndAddRelic"
  "removeConsumable"
  "defeatBoss"
  "resetPity"
  "unlockBoss"
  "incrementPity"
  "executeBossAttempt"
)

FOUND_REWARDS=""
for dir in "$SCREENS" "$COMPONENTS"; do
  if [ ! -d "$dir" ]; then continue; fi
  while IFS=: read -r file line content; do
    # Skip allowed files, tests, and node_modules
    if is_allowed "$file" "${ALLOWED_MUTATIONS[@]}"; then continue; fi
    if [[ "$file" == *".test."* ]]; then continue; fi
    FOUND_REWARDS+="  $file:$line: $content"$'\n'
  done < <(grep -rn "addCredits\|addXP\|addScrap\|addMaterial\|addEssence\|addCacheKeyFragments\|addItem\|generateAndAdd\|removeConsumable\|defeatBoss\|resetPity\|unlockBoss\|incrementPity\|executeBossAttempt" "$dir" --include="*.ts" --include="*.tsx" 2>/dev/null || true)
done

if [ -n "$FOUND_REWARDS" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$FOUND_REWARDS"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 2: No gameplay Math.random in screens/components
echo -n "Rule 2: No gameplay Math.random in screens/components... "
FOUND_RANDOM=""
for dir in "$SCREENS" "$COMPONENTS"; do
  if [ ! -d "$dir" ]; then continue; fi
  while IFS=: read -r file line content; do
    if is_allowed "$file" "${ALLOWED_RANDOM[@]}"; then continue; fi
    if [[ "$file" == *".test."* ]]; then continue; fi
    FOUND_RANDOM+="  $file:$line: $content"$'\n'
  done < <(grep -rn "Math\.random" "$dir" --include="*.ts" --include="*.tsx" 2>/dev/null || true)
done

if [ -n "$FOUND_RANDOM" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$FOUND_RANDOM"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 3: No gameplay setInterval in screens/components
echo -n "Rule 3: No unapproved setInterval in screens/components... "
FOUND_INTERVAL=""
for dir in "$SCREENS" "$COMPONENTS"; do
  if [ ! -d "$dir" ]; then continue; fi
  while IFS=: read -r file line content; do
    if is_allowed "$file" "${ALLOWED_TIMERS[@]}"; then continue; fi
    if [[ "$file" == *".test."* ]]; then continue; fi
    FOUND_INTERVAL+="  $file:$line: $content"$'\n'
  done < <(grep -rn "setInterval\|setTimeout" "$dir" --include="*.ts" --include="*.tsx" 2>/dev/null || true)
done

if [ -n "$FOUND_INTERVAL" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$FOUND_INTERVAL"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 4: No duplicate TickEventTone unions
echo -n "Rule 4: No duplicate TickEventTone type unions... "
DUPLICATE_TONE=$(grep -rn "type.*Tone.*=.*'xp'.*'loot'" "$SRC" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "tickSlice.ts" | grep -v "runEvents.ts" | grep -v ".test." | grep -v "node_modules" || true)
if [ -n "$DUPLICATE_TONE" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$DUPLICATE_TONE"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 5: No duplicate ActivityKind unions
echo -n "Rule 5: No duplicate ActivityKind type unions... "
DUPLICATE_ACTIVITY=$(grep -rn "type.*ActivityKind\|type.*=.*'none'.*'idle_standby'.*'roaming_loot'" "$SRC" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "types/activity.ts" | grep -v "\.test\." | grep -v "node_modules" | grep -v "^[^:]*:[0-9]*:import" || true)
if [ -n "$DUPLICATE_ACTIVITY" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$DUPLICATE_ACTIVITY"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 6: No localStorage for progression state (outside allowed files)
echo -n "Rule 6: No unapproved localStorage usage... "
ALLOWED_STORAGE=(
  "$SRC/lib/activity/activitySettlement.ts:cross-tab lock (coordination, not progression)"
  "$SRC/components/action/ActionLoadout.tsx:UI collapse preference (not progression)"
  "$SRC/components/pixelArt/LootMoment.tsx:UI celebration seen-preference for tap-to-skip (not progression)"
  "$SRC/store/slices/offlineRecapSlice.ts:display-only copy of already-settled offline rewards so the summary can be re-opened after dismissal (not progression; server settlement stays the only economy truth)"
  "$SRC/test/:test files"
)

FOUND_STORAGE=""
while IFS=: read -r file line content; do
  if is_allowed "$file" "${ALLOWED_STORAGE[@]}"; then continue; fi
  if [[ "$file" == *".test."* ]]; then continue; fi
  FOUND_STORAGE+="  $file:$line: $content"$'\n'
done < <(grep -rn "localStorage\|sessionStorage" "$SRC" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "node_modules" || true)

if [ -n "$FOUND_STORAGE" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$FOUND_STORAGE"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 7: As-casts around TickEvent/TickEventTone (in screens/components)
echo -n "Rule 7: Suspicious 'as' casts around event types in screens... "
FOUND_CASTS=""
while IFS=: read -r file line content; do
  if [[ "$file" == *".test."* ]]; then continue; fi
  FOUND_CASTS+="  $file:$line: $content"$'\n'
done < <(grep -rn "as TickEventTone\|as TickEvent\|as DisplayGainTone" "$SCREENS" "$COMPONENTS" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "runEvents.ts" || true)

if [ -n "$FOUND_CASTS" ]; then
  echo -e "${YELLOW}WARNING (review, not necessarily a violation)${NC}"
  echo "$FOUND_CASTS"
  # Warnings don't increment violation count — they need human review
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Rule 8: Runtime snapshots must not hydrate economy truth
echo -n "Rule 8: Runtime snapshots do not restore economy truth... "
SNAPSHOT_FILE="$SRC/store/runtimeSupabaseSync.ts"
FOUND_SNAPSHOT_AUTHORITY=""
if [ -f "$SNAPSHOT_FILE" ]; then
  FOUND_SNAPSHOT_AUTHORITY=$(grep -n "snapshotOnlyItems\|credits:.*player\.\|xp:.*player\.\|scrap:.*player\.\|cacheKeys:.*player\.\|cacheKeyFragments:.*player\.\|materials:.*player\.\|essences:.*player\.\|defeatedBossIds:.*boss\.\|unlockedBossIds:.*boss\.\|attemptHistory:.*boss\.\|listings:.*market\.\|history:.*market\.\|spent:.*skills" "$SNAPSHOT_FILE" || true)
fi
if [ -n "$FOUND_SNAPSHOT_AUTHORITY" ]; then
  echo -e "${RED}VIOLATIONS${NC}"
  echo "$FOUND_SNAPSHOT_AUTHORITY"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}OK${NC}"
fi
echo ""

# Summary
echo "---"
if [ "$VIOLATIONS" -eq 0 ]; then
  echo -e "${GREEN}Architecture guard passed — 0 violations.${NC}"
  exit 0
else
  echo -e "${RED}Architecture guard FAILED — $VIOLATIONS rule(s) have violations.${NC}"
  echo "Review each violation. If false positive, add the file to the allowlist with a reason."
  exit 1
fi
