#!/usr/bin/env bash
# Single play-session runner for Lane 2 of the CI overhaul (the
# emulator that plays — audit blueprint, REPORT.md §6.3).
#
# Invoked from .github/workflows/emulator-play.yml inside the
# reactivecircus/android-emulator-runner step (the action executes
# its `script:` input line-by-line through sh, so anything with
# functions or loops lives in a real file like this one — the same
# reason crawl-screen-inventory.sh exists).
#
# Shape (mirrors the screen-inventory crawl's recovery semantics,
# scoped to one session instead of six segments):
#   1. Verify the device is up; if not, restart the emulator once
#      before starting.
#   2. Install the app + play-test APKs (built by the workflow with
#      -PincludePlaySession, which is what puts PlaySessionTest in
#      the test APK at all — see android/app/build.gradle).
#   3. Run the ONE PlaySessionTest method via `am instrument`, then
#      pull the play-session output dir (play-result.json +
#      screenshots) immediately.
#   4. If the pull has no play-result.json, restart the emulator and
#      re-run ONCE. A second miss writes diagnostics and exits 0 —
#      the workflow's verify step turns missing/failed results red;
#      this script's failures are data, exactly like the crawl's.
#
# Outputs (under $GITHUB_WORKSPACE/play-out/, uploaded by the
# workflow as artifact emulator-play-evidence):
#   play-session/            the pulled output dir
#   play-session.instrument.log
#   diagnostics.txt          only if the session died twice
#
# Exit code is always 0 once invoked inside the emulator step.

set -u

WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"
OUT_ROOT="$WORKSPACE/play-out"
PULLED_DIR="$OUT_ROOT/play-session"
DEVICE_DIR="/sdcard/Android/data/com.michaelhmiv.cybercache/files/play-session"
APP_APK="$WORKSPACE/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$WORKSPACE/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
SESSION_TIMEOUT_S=420

mkdir -p "$OUT_ROOT"

log() { echo "[play-session] $*"; }

device_state() {
  adb get-state 2>/dev/null || echo "unknown"
}

restart_emulator() {
  # Relaunch the same AVD with the options the runner action used.
  log "restarting emulator"
  adb emu kill >/dev/null 2>&1 || true
  sleep 5
  local avd
  avd="$(adb shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r')"
  if [ -z "$avd" ]; then
    avd="$(emulator -list-avds 2>/dev/null | head -1)"
  fi
  nohup emulator -avd "$avd" -no-snapshot-save -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim >/dev/null 2>&1 &
  for _ in $(seq 1 60); do
    if [ "$(device_state)" = "device" ]; then
      adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
      return 0
    fi
    sleep 5
  done
  return 1
}

run_session_once() {
  adb install -r -t "$APP_APK" || return 1
  adb install -r -t "$TEST_APK" || return 1
  rm -rf "$PULLED_DIR"
  timeout "$SESSION_TIMEOUT_S" adb shell am instrument -w -r \
    -e class com.michaelhmiv.cybercache.PlaySessionTest#playSession \
    com.michaelhmiv.cybercache.test/androidx.test.runner.AndroidJUnitRunner \
    > "$OUT_ROOT/play-session.instrument.log" 2>&1 || true
  adb pull "$DEVICE_DIR" "$OUT_ROOT/" >/dev/null 2>&1 || true
  [ -f "$PULLED_DIR/play-result.json" ]
}

if [ "$(device_state)" != "device" ]; then
  restart_emulator || true
fi

if run_session_once; then
  log "session produced play-result.json"
  exit 0
fi

log "no play-result.json — one emulator restart + retry"
restart_emulator || true
if run_session_once; then
  log "session produced play-result.json on retry"
  exit 0
fi

{
  echo "play session produced no play-result.json after one restart + retry"
  echo "device state: $(device_state)"
  adb devices || true
  tail -50 "$OUT_ROOT/play-session.instrument.log" || true
} > "$OUT_ROOT/diagnostics.txt"
log "session died twice; diagnostics written"
exit 0
