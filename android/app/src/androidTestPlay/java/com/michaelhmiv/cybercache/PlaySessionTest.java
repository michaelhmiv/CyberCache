package com.michaelhmiv.cybercache;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lane 2 of the CI overhaul (audit blueprint, REPORT.md §6.3): the
 * emulator that PLAYS. Where ScreenInventoryTest crawls every screen
 * for design evidence, this test runs ONE real play session on the
 * real WebView build and records — as data in play-result.json — the
 * outcomes the blueprint names:
 *
 *   1. launch → Continue as Guest → the Home screen arrives;
 *   2. Start Roam → the stage is alive across three spaced captures
 *      (the pixel verdict itself is computed runner-side by
 *      scripts/play-session-pixels.py on the pulled screenshots);
 *   3. open a cache with a key → the reveal completes (DECRYPTING
 *      appears, then clears, and the settled deck's actions show).
 *
 * Assertions are DATA, not test failures, mirroring the crawl's
 * contract: the only hard failure is the app not launching at all.
 * scripts/play-session.sh pulls the output dir after the run and the
 * workflow gate turns the JSON + pixel verdicts red or green. This
 * separation is what lets a dead emulator cost one retry instead of
 * the whole lane's evidence.
 *
 * Like ScreenInventoryTest, this class lives OUTSIDE the default
 * androidTest source set (src/androidTestPlay) and only joins the
 * test APK when -PincludePlaySession is passed (see
 * android/app/build.gradle), so the per-PR connectedDebugAndroidTest
 * job never picks it up.
 */
@RunWith(AndroidJUnit4.class)
public class PlaySessionTest {

    private static final String TAG = "PlaySession";
    private static final String PACKAGE = 'com.michaelhmiv.cybercache';
    private static final String OUT_DIR_NAME = 'play-session';

    private UiDevice device;
    private File outDir;
    private int displayWidth;
    private int displayHeight;
    private final Map<String, Boolean> assertions = new LinkedHashMap<>();
    private final Map<String, String> notes = new LinkedHashMap<>();

    @Before
    public void setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        displayWidth = device.getDisplayWidth();
        displayHeight = device.getDisplayHeight();
        try {
            device.wakeUp();
        } catch (Exception ignored) {
            // Best effort — the emulator boots unlocked for this harness.
        }
        try {
            device.executeShellCommand("wm dismiss-keyguard");
        } catch (Exception ignored) {
            // Best effort only.
        }
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File external = target.getExternalFilesDir(OUT_DIR_NAME);
        if (external != null) {
            outDir = external;
        } else {
            outDir = new File(target.getFilesDir(), OUT_DIR_NAME);
        }
        if (!outDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            outDir.mkdirs();
        }
        Log.i(TAG, "Output dir: " + outDir.getAbsolutePath());
    }

    // ------------------------------------------------------------------
    // Primitives (the crawl's verified-find discipline, condensed):
    // live queries only, viewport-bounds filtering, text first.
    // ------------------------------------------------------------------

    private void settle() {
        device.waitForIdle(3000);
        SystemClock.sleep(1200);
    }

    private UiObject2 findVisible(String needle, boolean contains, long timeoutMs) {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            List<UiObject2> objs = contains
                    ? device.findObjects(By.textContains(needle))
                    : device.findObjects(By.text(needle));
            UiObject2 best = null;
            int bestLen = Integer.MAX_VALUE;
            if (objs != null) {
                for (UiObject2 o : objs) {
                    try {
                        Rect b = o.getVisibleBounds();
                        if (b == null || b.bottom <= 0 || b.top >= displayHeight) {
                            continue;
                        }
                        String label = o.getText();
                        if (label == null) {
                            label = o.getContentDescription();
                        }
                        int len = label == null ? Integer.MAX_VALUE - 1 : label.length();
                        if (len < bestLen) {
                            bestLen = len;
                            best = o;
                        }
                    } catch (Exception ignored) {
                        // Stale node — the next poll re-queries live.
                    }
                }
            }
            if (best != null) {
                return best;
            }
            SystemClock.sleep(600);
        }
        return null;
    }

    private boolean bodyContains(String needle) {
        List<UiObject2> objs = device.findObjects(By.textContains(needle));
        return objs != null && !objs.isEmpty();
    }

    private boolean click(String needle, boolean contains, long timeoutMs) {
        UiObject2 o = findVisible(needle, contains, timeoutMs);
        if (o == null) {
            return false;
        }
        try {
            o.click();
            return true;
        } catch (Exception e) {
            // A text node inside a WebView is not always the clickable
            // element; fall back to tapping its centre.
            try {
                Rect b = o.getVisibleBounds();
                device.click(b.centerX(), b.centerY());
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    private void snap(String name) {
        File png = new File(outDir, name + ".png");
        try {
            device.takeScreenshot(png);
        } catch (Exception e) {
            Log.e(TAG, "takeScreenshot failed for " + name, e);
        }
    }

    private void launchApp() {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent intent = target.getPackageManager().getLaunchIntentForPackage(PACKAGE);
        if (intent == null) {
            throw new IllegalStateException("no launch intent for " + PACKAGE);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        target.startActivity(intent);
    }

    private void record(String key, boolean ok, String note) {
        assertions.put(key, ok);
        if (note != null) {
            notes.put(key, note);
        }
        Log.i(TAG, "assertion " + key + " = " + ok + (note == null ? "" : " (" + note + ")"));
    }

    private void writeResult() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n  \"package\": \"").append(PACKAGE).append("\",\n  \"assertions\": {");
        boolean first = true;
        for (Map.Entry<String, Boolean> e : assertions.entrySet()) {
            if (!first) {
                sb.append(",");
            }
            first = false;
            sb.append("\n    \"").append(e.getKey()).append("\": ").append(e.getValue());
        }
        sb.append("\n  },\n  \"notes\": {");
        first = true;
        for (Map.Entry<String, String> e : notes.entrySet()) {
            if (!first) {
                sb.append(",");
            }
            first = false;
            String safe = e.getValue().replace("\\", "\\\\").replace("\"", "\\\"");
            sb.append("\n    \"").append(e.getKey()).append("\": \"").append(safe).append("\"");
        }
        sb.append("\n  }\n}\n");
        File out = new File(outDir, "play-result.json");
        try (FileWriter w = new FileWriter(out)) {
            w.write(sb.toString());
        } catch (IOException e) {
            Log.e(TAG, "could not write play-result.json", e);
        }
    }

    // ------------------------------------------------------------------
    // The session
    // ------------------------------------------------------------------

    @Test
    public void playSession() {
        launchApp();

        // 1 — Guest entry.
        boolean guestOffered = findVisible("Continue as Guest", false, 90_000) != null;
        record("guestEntryOffered", guestOffered, null);
        if (!guestOffered) {
            snap("play-launch-failure");
            writeResult();
            throw new IllegalStateException("app launched but guest entry never appeared");
        }
        click("Continue as Guest", false, 10_000);
        boolean homeArrived = findVisible("HUNTER", true, 60_000) != null
                && findVisible("GEAR", true, 5_000) != null;
        record("guestEntered", homeArrived, null);
        // The starter Collect modal may sit over Home; dismiss it the
        // way a player does.
        if (bodyContains("Collect")) {
            click("Collect", false, 5_000);
        }
        settle();
        snap("play-home");

        // 2 — Roam: the stage must be alive across spaced captures.
        boolean roamStarted = click("Start Roam", true, 20_000);
        record("roamStarted", roamStarted, null);
        if (roamStarted) {
            SystemClock.sleep(4000);
            snap("play-roam-1");
            SystemClock.sleep(8000);
            snap("play-roam-2");
            SystemClock.sleep(8000);
            snap("play-roam-3");
        }

        // 3 — Cache: open with a key, the reveal must complete.
        boolean cacheOpened = false;
        boolean revealCompleted = false;
        String cacheNote = null;
        UiObject2 cacheEntry = findVisible("Caches", true, 10_000);
        if (cacheEntry == null) {
            cacheEntry = findVisible("Cache", true, 5_000);
        }
        if (cacheEntry == null) {
            cacheNote = "no cache entry control found by text";
        } else {
            try {
                cacheEntry.click();
            } catch (Exception e) {
                Rect b = cacheEntry.getVisibleBounds();
                device.click(b.centerX(), b.centerY());
            }
            settle();
            if (click("OPEN WITH KEY", false, 20_000)) {
                cacheOpened = true;
                boolean sawDecrypting = false;
                boolean settledDeck = false;
                long deadline = SystemClock.uptimeMillis() + 45_000;
                while (SystemClock.uptimeMillis() < deadline) {
                    if (bodyContains("DECRYPTING")) {
                        sawDecrypting = true;
                    }
                    if (!bodyContains("DECRYPTING")
                            && (bodyContains("Collect") || bodyContains("Equip") || bodyContains("Salvage"))) {
                        settledDeck = true;
                        break;
                    }
                    SystemClock.sleep(800);
                }
                revealCompleted = sawDecrypting && settledDeck;
                cacheNote = "sawDecrypting=" + sawDecrypting + " settledDeck=" + settledDeck;
                snap("play-reveal");
            } else {
                cacheNote = "OPEN WITH KEY control not found (guest keys from the initial bundle expected)";
            }
        }
        record("cacheOpened", cacheOpened, cacheNote);
        record("revealCompleted", revealCompleted, cacheNote);

        writeResult();
    }
}
