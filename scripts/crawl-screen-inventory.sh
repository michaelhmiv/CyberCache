#!/usr/bin/env bash
# Segment runner for the screen-inventory crawl.
#
# Invoked from .github/workflows/screen-inventory.yml inside the
# reactivecircus/android-emulator-runner step (the action executes its
# `script:` input line-by-line through sh, so anything with functions
# or loops has to live in a real file like this one — the workflow's
# script is a single call to this file).
#
# WHY SEGMENTS: run 2 (41343111864, 2026-11-01) produced ZERO
# screenshots — the emulator died ~4.5 minutes into the single
# monolithic crawl (adb: device offline; emu kill: connection
# refused), and everything on-device was lost because the only pull
# happened after the whole crawl. This runner invokes each crawl
# segment (one @Test method in ScreenInventoryTest) as its OWN
# `am instrument` call and pulls the output directory after EVERY
# segment, so a dead emulator can cost at most one segment.
#
# RECOVERY SEMANTICS:
#  - Before each segment: `adb get-state` must say "device"; if not,
#    the emulator is restarted once (relaunching the same AVD with the
#    same options the runner action used) before the segment starts.
#  - If a segment's pull contains no manifest.json, diagnostics are
#    written (diagnostics-<segment>.txt), the emulator is restarted,
#    and the segment is re-run ONCE.
#  - If the retry still produces no manifest, the segment is recorded
#    in dead-segments.txt; scripts/merge-screen-inventory.py later
#    records its stops as missed with reason "emulator died", and this
#    runner CONTINUES with the next segment (whose own pre-segment
#    health check restarts the emulator again if needed). A double
#    emulator death in one segment therefore costs that segment only.
#
# Outputs (under $GITHUB_WORKSPACE/screen-inventory-out/):
#  - segments/<segment>/screen-inventory/  that segment's pull
#  - segments/<segment>.instrument.log     raw instrument output
#  - diagnostics-<segment>.txt             only for segments that died
#  - dead-segments.txt                     one dead segment per line
# The workflow merges these into screen-inventory-final/ next.
#
# Exit code is always 0: segment failures are data for the merge +
# verify steps, which are what turn the run red.

set -u

PKG="com.michaelhmiv.cybercache"
TEST_CLASS="com.michaelhmiv.cybercache.ScreenInventoryTest"
RUNNER="$PKG.test/androidx.test.runner.AndroidJUnitRunner"
DEVICE_DIR="/sdcard/Android/data/$PKG/files/screen-inventory"
DEVICE_DIR_ALT="/storage/emulated/0/Android/data/$PKG/files/screen-inventory"
APP_APK="app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
# Generous per-attempt bound: the board segment alone waits out a
# 120s cold-start budget plus 8 stops with retries. A wedged
# instrument (device dying silently) must not eat the whole job.
SEGMENT_TIMEOUT_S=1500

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
# APK paths above are relative to android/ (the emulator step's
# working directory); anchor there regardless of the caller's cwd.
cd "$REPO_ROOT/android" || exit 1

WORKSPACE="${GITHUB_WORKSPACE:-$REPO_ROOT}"
OUT="$WORKSPACE/screen-inventory-out"
SEGDIR="$OUT/segments"
mkdir -p "$SEGDIR"
: > "$OUT/dead-segments.txt"

# segment name -> @Test method (canonical order; the merge script
# holds the matching stop lists — keep them in sync).
SEGMENTS=(
  "board:crawlBoardSegment"
  "action:crawlActionSegment"
  "gear:crawlGearSegment"
  "market:crawlMarketSegment"
  "rank:crawlRankSegment"
  "hunter:crawlHunterSegment"
)

device_ok() {
  [ "$(adb get-state 2>/dev/null)" = "device" ]
}

# Relaunch the AVD the runner action created, with the same emulator
# options it used (verified against run 41343111864's job log:
# AVD "test", port 5554). App installs and animation settings are
# re-applied: a restarted emulator is not guaranteed to have kept them.
restart_emulator() {
  echo "== Restarting emulator =="
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
  local emu="$sdk/emulator/emulator"
  local avd=""
  if [ -d "$HOME/.android/avd" ]; then
    avd="$(ls "$HOME/.android/avd" | sed -n 's/\.avd$//p' | head -1)"
  fi
  if [ -z "$avd" ] || [ ! -x "$emu" ]; then
    echo "Cannot restart emulator: binary or AVD not found (emu=$emu avd='${avd:-none}')"
    return 1
  fi
  # Kill any half-dead emulator still holding the AVD, and cycle the
  # adb server in case the daemon itself is what wedged.
  pkill -f "emulator.*-avd $avd" 2>/dev/null || true
  sleep 3
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null 2>&1 || true
  # shellcheck disable=SC2086 # $avd is a single discovered name, no spaces
  nohup "$emu" -port 5554 -avd "$avd" -no-window -gpu swiftshader_indirect \
    -no-snapshot -noaudio -no-boot-anim > "$OUT/emulator-restart.log" 2>&1 &
  adb wait-for-device || return 1
  local i
  for i in $(seq 1 72); do
    if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      break
    fi
    if [ "$i" = "72" ]; then
      echo "Emulator did not finish booting within 6 minutes"
      return 1
    fi
    sleep 5
  done
  # Re-apply the runner action's environment: animations off (its
  # disable-animations step), both APKs installed.
  adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
  adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
  adb install -r -t "$APP_APK" || return 1
  adb install -r -t "$TEST_APK" || return 1
  device_ok
}

# Pre-segment health gate: restart once if the device is not healthy.
ensure_device() {
  if device_ok; then
    return 0
  fi
  echo "Device unhealthy (adb get-state: $(adb get-state 2>&1)); restarting emulator once."
  restart_emulator
}

# Pull the on-device inventory dir for one segment. Succeeds only when
# the pull contains a manifest.json written by THIS segment attempt
# (the caller clears the on-device dir before every attempt, so a
# stale manifest from a previous segment can never pose as this
# segment's result).
pull_segment() {
  local seg="$1" dest="$SEGDIR/$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  adb root >/dev/null 2>&1 || true
  adb pull "$DEVICE_DIR" "$dest" >/dev/null 2>&1 \
    || adb pull "$DEVICE_DIR_ALT" "$dest" >/dev/null 2>&1 \
    || true
  [ -f "$dest/screen-inventory/manifest.json" ]
}

# Failure evidence for a segment whose pull found no manifest:
# adb state + instrument log tail + emulator restart log tail +
# the last ~200 lines of logcat (when the device can still serve it).
write_diagnostics() {
  local seg="$1" file="$OUT/diagnostics-$seg.txt"
  {
    echo "Screen inventory diagnostics — segment '$seg'"
    echo "The segment's pull contained no manifest.json."
    echo "adb get-state: $(adb get-state 2>&1)"
    echo ""
    echo "----- instrument log (last 50 lines) -----"
    tail -50 "$SEGDIR/$seg.instrument.log" 2>/dev/null || echo "(no instrument log)"
    echo ""
    echo "----- emulator restart log (last 30 lines) -----"
    tail -30 "$OUT/emulator-restart.log" 2>/dev/null || echo "(emulator was never restarted)"
    echo ""
    echo "----- logcat (last 200 lines) -----"
    adb logcat -d 2>/dev/null | tail -200 || echo "(logcat unavailable — device unreachable)"
  } > "$file" 2>/dev/null || true
  echo "Diagnostics written to $file"
}

run_segment() {
  local seg="$1" method="$2" attempt
  echo "==================== Segment: $seg ($method) ===================="
  ensure_device || true
  for attempt in 1 2; do
    if device_ok; then
      # Clear the on-device output so the manifest this attempt is
      # judged by can only be its own (earlier segments' files are
      # already pulled to the runner — clearing loses nothing).
      adb root >/dev/null 2>&1 || true
      adb shell rm -rf "$DEVICE_DIR" >/dev/null 2>&1 || true
      echo "Running segment $seg (attempt $attempt)…"
      timeout "$SEGMENT_TIMEOUT_S" adb shell am instrument -w -r \
        -e class "$TEST_CLASS#$method" "$RUNNER" \
        > "$SEGDIR/$seg.instrument.log" 2>&1 || true
      tail -3 "$SEGDIR/$seg.instrument.log" || true
    else
      echo "No healthy device for segment $seg attempt $attempt — skipping the instrument run."
      : > "$SEGDIR/$seg.instrument.log"
    fi
    if pull_segment "$seg"; then
      echo "Segment $seg: manifest pulled."
      # A diagnostics file from a failed first attempt is history the
      # job log already tells; the recovered segment ships clean.
      rm -f "$OUT/diagnostics-$seg.txt"
      return 0
    fi
    echo "Segment $seg attempt $attempt produced no manifest."
    write_diagnostics "$seg"
    if [ "$attempt" = "1" ]; then
      echo "Restarting emulator and retrying segment $seg once."
      restart_emulator || true
    fi
  done
  echo "$seg" >> "$OUT/dead-segments.txt"
  echo "Segment $seg DEAD after restart + retry — its stops will be recorded as missed (emulator died); continuing."
  return 1
}

adb wait-for-device
adb install -r -t "$APP_APK"
adb install -r -t "$TEST_APK"

for pair in "${SEGMENTS[@]}"; do
  run_segment "${pair%%:*}" "${pair##*:}" || true
done

echo "All segments attempted. Dead segments: $(tr '\n' ' ' < "$OUT/dead-segments.txt")"
find "$OUT" -maxdepth 3 -type f | sort | head -100 || true
exit 0
