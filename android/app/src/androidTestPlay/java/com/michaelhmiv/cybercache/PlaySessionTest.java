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
import java.util.ArrayList;
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
    private static final String PACKAGE = "com.michaelhmiv.cybercache";
    private static final String OUT_DIR_NAME = "play-session";

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

    // Verified-find discipline ported from the screen-inventory
    // crawl (ScreenInventoryTest), which operates this same app on
    // this same emulator image: search TEXT first, then the content
    // DESCRIPTION (WebView aria labels surface as descriptions, and
    // rounds 1–2 proved text-only search misses real controls),
    // keep only nodes whose bounds intersect the band, and prefer
    // the SMALLEST node — aggregated ancestor containers carry the
    // same strings and their centres tap the wrong place.

    private UiObject2 pickVisible(List<UiObject2> objs, int minY, int maxY) {
        UiObject2 best = null;
        int bestArea = Integer.MAX_VALUE;
        if (objs == null) {
            return null;
        }
        for (UiObject2 o : objs) {
            try {
                Rect b = o.getVisibleBounds();
                if (b == null || b.height() <= 0 || b.width() <= 0) {
                    continue;
                }
                if (b.bottom < minY || b.top > maxY) {
                    continue;
                }
                if (b.bottom <= 0 || b.top >= displayHeight) {
                    continue;
                }
                int area = b.width() * b.height();
                if (area < bestArea) {
                    bestArea = area;
                    best = o;
                }
            } catch (Exception ignored) {
                // Stale node — the next query re-reads live.
            }
        }
        return best;
    }

    private UiObject2 visibleFind(String needle, int minY, int maxY) {
        UiObject2 byText = pickVisible(device.findObjects(By.textContains(needle)), minY, maxY);
        if (byText != null) {
            return byText;
        }
        return pickVisible(device.findObjects(By.descContains(needle)), minY, maxY);
    }

    /** Verified find anywhere in the viewport. */
    private UiObject2 vf(String needle) {
        return visibleFind(needle, 0, displayHeight);
    }

    /** Verified find in the top region (headers, tab rows, chips). */
    private UiObject2 vfTop(String needle) {
        return visibleFind(needle, 0, (int) (displayHeight * 0.45));
    }

    /** Poll until any needle is visibly present; returns it or null. */
    private String waitVisible(long timeoutMs, String... needles) {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (true) {
            for (String n : needles) {
                if (vf(n) != null) {
                    return n;
                }
            }
            if (SystemClock.uptimeMillis() >= deadline) {
                return null;
            }
            SystemClock.sleep(500);
        }
    }

    private UiObject2 findVisible(String needle, boolean contains, long timeoutMs) {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            UiObject2 o = vf(needle);
            if (o != null) {
                return o;
            }
            SystemClock.sleep(500);
        }
        return null;
    }

    private boolean bodyContains(String needle) {
        return vf(needle) != null;
    }

    private boolean tapObject(UiObject2 o) {
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

    private boolean click(String needle, boolean contains, long timeoutMs) {
        return tapObject(findVisible(needle, contains, timeoutMs));
    }

    /** Tap the verified node for a needle, if present right now. */
    private boolean tapVisible(String needle) {
        UiObject2 o = vf(needle);
        if (o == null) {
            return false;
        }
        boolean ok = tapObject(o);
        if (ok) {
            settle();
        }
        return ok;
    }

    private void swipeDown() {
        device.swipe(displayWidth / 2, (int) (displayHeight * 0.72),
                displayWidth / 2, (int) (displayHeight * 0.30), 22);
        SystemClock.sleep(700);
    }

    private void swipeToTop() {
        device.swipe(displayWidth / 2, (int) (displayHeight * 0.30),
                displayWidth / 2, (int) (displayHeight * 0.75), 22);
        SystemClock.sleep(500);
    }

    /** Bounded scroll to the top; stops when the top bar is back. */
    private void scrollToTop() {
        for (int i = 0; i < 5; i++) {
            if (vfTop("cache keys held") != null || vf("Hunter modes") != null) {
                return;
            }
            swipeToTop();
        }
    }

    /**
     * Scroll-search: scan, swipe down, scan … up to maxSwipes.
     * Returns the number of swipes used (0 = already visible), or -1.
     */
    private int scrollSearch(int maxSwipes, String... needles) {
        for (String n : needles) {
            if (vf(n) != null) {
                return 0;
            }
        }
        for (int i = 1; i <= maxSwipes; i++) {
            swipeDown();
            for (String n : needles) {
                if (vf(n) != null) {
                    return i;
                }
            }
        }
        return -1;
    }

    private void snap(String name) {
        File png = new File(outDir, name + ".png");
        try {
            device.takeScreenshot(png);
        } catch (Exception e) {
            Log.e(TAG, "takeScreenshot failed for " + name, e);
        }
    }

    /** Accessibility-tree dump — calibration evidence for WHY a
     *  text-searched control was not found (label variants, below
     *  the fold, a modal in the way). Pulled with the screenshots. */
    private void dumpHierarchy(String name) {
        try {
            device.dumpWindowHierarchy(new File(outDir, name + ".xml"));
        } catch (Exception e) {
            Log.e(TAG, "hierarchy dump failed for " + name, e);
        }
    }

    /**
     * Economy snapshot from the top-bar description nodes:
     * [credits, xpProgress]. The roaming state's title plate is
     * canvas-rendered and never enters the accessibility tree
     * (round-5 evidence: "Roaming Loot"/"Sweeping the area" absent
     * while credits/XP demonstrably ticked), so a started roam is
     * verified by what a player watches: the counters moving.
     * Returns -1 for a counter that cannot be read.
     */
    private long[] economySnapshot() {
        long credits = -1;
        long xp = -1;
        try {
            List<UiObject2> nodes = new ArrayList<>();
            List<UiObject2> byDesc = device.findObjects(By.descContains("Credits"));
            if (byDesc != null) nodes.addAll(byDesc);
            List<UiObject2> byText = device.findObjects(By.textContains("Credits"));
            if (byText != null) nodes.addAll(byText);
            for (UiObject2 o : nodes) {
                String label = o.getContentDescription();
                if (label == null) label = o.getText();
                if (label == null) continue;
                // Anchored to the top-bar node's exact shape
                // ("Credits — 5004"): once roaming, a "ROAMING LOOT
                // MODS: Credits/Kill +5%" node also contains
                // "Credits", and the unanchored pattern read its 5
                // as the balance — the round-7/8 verify blindness.
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("^Credits\\s+\\u2014\\s*([0-9][0-9,]*)").matcher(label);
                if (m.find()) {
                    credits = Long.parseLong(m.group(1).replace(",", ""));
                    break;
                }
            }
            List<UiObject2> xpNodes = new ArrayList<>();
            List<UiObject2> xpDesc = device.findObjects(By.descContains("XP to next level"));
            if (xpDesc != null) xpNodes.addAll(xpDesc);
            List<UiObject2> xpText = device.findObjects(By.textContains("XP to next level"));
            if (xpText != null) xpNodes.addAll(xpText);
            for (UiObject2 o : xpNodes) {
                String label = o.getContentDescription();
                if (label == null) label = o.getText();
                if (label == null) continue;
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("([0-9][0-9,]*) of [0-9,]+ XP").matcher(label);
                if (m.find()) {
                    xp = Long.parseLong(m.group(1).replace(",", ""));
                    break;
                }
            }
        } catch (Exception ignored) {
            // Best effort — the caller treats -1 as unreadable.
        }
        return new long[]{credits, xp};
    }

    /** Keys held, parsed from the cache screen's own button label
     *  ("OPEN WITH KEY (2)" — the count is the key balance). */
    private int keysHeld() {
        try {
            List<UiObject2> nodes = new ArrayList<>();
            List<UiObject2> a = device.findObjects(By.textContains("OPEN WITH KEY"));
            if (a != null) nodes.addAll(a);
            List<UiObject2> b = device.findObjects(By.descContains("OPEN WITH KEY"));
            if (b != null) nodes.addAll(b);
            for (UiObject2 o : nodes) {
                String label = o.getContentDescription();
                if (label == null) label = o.getText();
                if (label == null) continue;
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("OPEN WITH KEY \\((\\d+)\\)").matcher(label);
                if (m.find()) return Integer.parseInt(m.group(1));
            }
        } catch (Exception ignored) {
            // Best effort.
        }
        return -1;
    }

    /** Inventory size from the top bar's "Loot — N items" node. */
    private int lootCount() {
        try {
            List<UiObject2> nodes = new ArrayList<>();
            List<UiObject2> a = device.findObjects(By.descContains("Loot \u2014"));
            if (a != null) nodes.addAll(a);
            List<UiObject2> b = device.findObjects(By.textContains("Loot \u2014"));
            if (b != null) nodes.addAll(b);
            for (UiObject2 o : nodes) {
                String label = o.getContentDescription();
                if (label == null) label = o.getText();
                if (label == null) continue;
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("Loot\\s+\\u2014\\s*(\\d+)").matcher(label);
                if (m.find()) return Integer.parseInt(m.group(1));
            }
        } catch (Exception ignored) {
            // Best effort.
        }
        return -1;
    }

    private void swipeUp() {
        device.swipe(displayWidth / 2, (int) (displayHeight * 0.75),
                displayWidth / 2, (int) (displayHeight * 0.35), 24);
        settle();
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
        boolean guestOffered = waitVisible(90_000, "Continue as Guest") != null;
        record("guestEntryOffered", guestOffered, null);
        if (!guestOffered) {
            snap("play-launch-failure");
            writeResult();
            throw new IllegalStateException("app launched but guest entry never appeared");
        }
        tapVisible("Continue as Guest");
        // Home arrival = BOTH shell tabs present, polled together:
        // round 2 recorded guestEntered=false while the home
        // hierarchy (dumped seconds later) was fully loaded — the
        // sequential two-step check raced a slow production sign-in.
        boolean homeArrived = false;
        long homeDeadline = SystemClock.uptimeMillis() + 90_000;
        while (SystemClock.uptimeMillis() < homeDeadline) {
            if (vf("HUNTER") != null && vf("GEAR") != null) {
                homeArrived = true;
                break;
            }
            SystemClock.sleep(500);
        }
        record("guestEntered", homeArrived, null);
        // The starter Collect modal may sit over Home; dismiss it the
        // way a player does.
        if (bodyContains("Collect")) {
            click("Collect", false, 5_000);
        }
        settle();
        snap("play-home");
        dumpHierarchy("play-home-hierarchy");

        // 2 — Roam: tap the standby panel's start control (the
        // diorama's aria node reads START ROAM; the panel button
        // reads Start Roam), scroll-searching like the crawl, then
        // VERIFY the roaming state — a tap that changes nothing is
        // not a started roam (crawl semantics; rounds 1–2 tapped
        // blind and learned nothing from the miss).
        String roamNote = null;
        long[] economyBefore = economySnapshot();
        int lootBeforeRoam = lootCount();
        // Arm the Roam rail stop first — the standby panel's start
        // control belongs to the armed stop (round 3 hunted for it
        // on an un-armed standby and found nothing, even scrolling).
        UiObject2 roamStop = vf("start roaming and choose the area");
        if (roamStop != null) {
            tapObject(roamStop);
            settle();
        }
        dumpHierarchy("play-roam-hierarchy");
        boolean roamClicked = tapVisible("Start Roam") || tapVisible("START ROAM");
        if (!roamClicked) {
            int swipes = scrollSearch(4, "Start Roam", "START ROAM");
            if (swipes >= 0) {
                roamClicked = tapVisible("Start Roam") || tapVisible("START ROAM");
                if (swipes > 0) {
                    roamNote = "start control found after " + swipes + " scroll swipes";
                }
            } else {
                roamNote = "start control not found (rail stop "
                        + (roamStop != null ? "armed" : "NOT FOUND") + ", 4 scroll swipes)";
            }
        }
        // Verify the roam by its economy: the stage's title plate is
        // canvas-rendered (never in the tree), but a live roam ticks
        // credits and XP upward within seconds — round 5's post-tap
        // dump showed exactly that (+4cr, +6xp) while the text
        // needles matched nothing. Tap-until-verified (up to 3
        // attempts): round 7's single tap produced no movement in
        // 30 s while round 6's verified in seconds — the native
        // tap->effect path on this emulator is intermittent, and a
        // player taps again when nothing happens.
        boolean roamStarted = false;
        if (roamClicked) {
            for (int attempt = 1; attempt <= 3 && !roamStarted; attempt++) {
                if (attempt > 1) {
                    tapVisible("Start Roam");
                    tapVisible("START ROAM");
                }
                long verifyDeadline = SystemClock.uptimeMillis() + 14_000;
                while (SystemClock.uptimeMillis() < verifyDeadline) {
                    // State needles that exist only while roaming:
                    // the roaming panel's "ACTIVE AREA" header and
                    // its "ROAMING LOOT MODS" strip (round-8 after-
                    // dump). The economy counters turned out to be
                    // settlement-gated — they can sit still for a
                    // whole verify window on a healthy roam — so
                    // they are supporting signals, not the gate.
                    if (vf("Roaming Loot") != null || vf("Sweeping the area") != null
                            || vf("ACTIVE AREA") != null || vf("LOOT MODS") != null) {
                        roamStarted = true;
                        roamNote = "verified by roaming state labels (attempt " + attempt + ")";
                        break;
                    }
                    long[] now = economySnapshot();
                    if (economyBefore[0] >= 0 && now[0] > economyBefore[0]) {
                        roamStarted = true;
                        roamNote = "verified by credits tick " + economyBefore[0] + " -> " + now[0]
                                + " (attempt " + attempt + ")";
                        break;
                    }
                    if (economyBefore[1] >= 0 && now[1] > economyBefore[1]) {
                        roamStarted = true;
                        roamNote = "verified by XP tick " + economyBefore[1] + " -> " + now[1]
                                + " (attempt " + attempt + ")";
                        break;
                    }
                    // Loot accrual is the roam's other unambiguous
                    // effect (round 9: the counters never visibly
                    // moved while the guest quietly gained 11 items).
                    int lootNow = lootCount();
                    if (lootBeforeRoam >= 0 && lootNow > lootBeforeRoam) {
                        roamStarted = true;
                        roamNote = "verified by loot accrual " + lootBeforeRoam + " -> " + lootNow
                                + " (attempt " + attempt + ")";
                        break;
                    }
                    SystemClock.sleep(1200);
                }
            }
        }
        if (roamClicked && !roamStarted) {
            roamNote = "start tapped (3 attempts) but no economy movement (before: credits="
                    + economyBefore[0] + " xp=" + economyBefore[1] + ")";
        }
        // Evidence of the post-tap state either way (round 4's tap
        // landed but the verify needles never matched — the next
        // calibration step needs to see what the stage actually
        // calls itself while roaming).
        dumpHierarchy("play-roam-after");
        snap("play-roam-attempt");
        record("roamStarted", roamStarted, roamNote);
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
        // Stop the roam first: the cache chest does not open over a
        // live roam (round 6: the entry tap landed on the roaming
        // Home and nothing navigated; the tree showed the stage's
        // Stop control). Standby returning is the verify.
        if (tapVisible("Stop")) {
            waitVisible(15_000, "Standing by", "Start Roam", "START ROAM");
            settle();
        }
        // Reset to the top of the screen first — the roam leg may
        // have left the scroll anywhere, and the top bar (with the
        // cache control) only exists in the tree at the top.
        scrollToTop();
        int lootBefore = lootCount();
        // The cache entry is the top-bar control whose description
        // reads "Cache — N cache keys held. Opens the cache chest."
        // (round-2 hierarchy evidence). The unique "cache keys held"
        // needle cannot collide with the app title or page content.
        UiObject2 cacheEntry = vfTop("cache keys held");
        if (cacheEntry == null) {
            cacheEntry = vfTop("Cache");
        }
        if (cacheEntry == null) {
            cacheNote = "no cache entry control found (top bar, by description)";
        } else {
            tapObject(cacheEntry);
            // VERIFY the cache screen arrived before hunting the key
            // action — rounds 2–3 hunted blind on the wrong screen.
            String arrived = waitVisible(20_000,
                    "OPEN WITH KEY", "Open with key", "CRACK CACHE", "Spend keys for server-rolled gear");
            // The count label can lag the screen's first paint
            // (round 9 read -1 at arrival, then 2 after the spend).
            int keysBefore = -1;
            for (int i = 0; i < 10 && keysBefore < 0; i++) {
                keysBefore = keysHeld();
                if (keysBefore < 0) SystemClock.sleep(500);
            }
            dumpHierarchy("play-cache-hierarchy");
            boolean keyClicked = false;
            if (arrived == null) {
                cacheNote = "cache entry tapped but the cache screen never verified";
            } else {
                keyClicked = tapVisible("OPEN WITH KEY") || tapVisible("Open with key");
                if (!keyClicked) {
                    int swipes = scrollSearch(3, "OPEN WITH KEY", "Open with key");
                    if (swipes >= 0) {
                        keyClicked = tapVisible("OPEN WITH KEY") || tapVisible("Open with key");
                    }
                    dumpHierarchy("play-cache-hierarchy-scrolled");
                }
                if (!keyClicked) {
                    cacheNote = "cache screen verified (" + arrived + ") but OPEN WITH KEY not found";
                }
            }
            if (keyClicked) {
                cacheOpened = true;
                // Tap-until-fired (round 7: the tap was accepted by
                // the tree but the open never fired — Keys stayed 3
                // and no reveal existed at 12 s or 45 s; round 5's
                // identical tap spent the key). Probe briefly for
                // any sign the decrypt began; re-tap when none.
                boolean fired = false;
                for (int attempt = 1; attempt <= 3 && !fired; attempt++) {
                    if (attempt > 1) {
                        if (!tapVisible("OPEN WITH KEY") && !tapVisible("Open with key")) {
                            break;
                        }
                    }
                    long probeDeadline = SystemClock.uptimeMillis() + 7_000;
                    while (SystemClock.uptimeMillis() < probeDeadline) {
                        if (bodyContains("DECRYPTING") || bodyContains("Collect")
                                || bodyContains("Equip") || bodyContains("Salvage")) {
                            fired = true;
                            break;
                        }
                        SystemClock.sleep(700);
                    }
                }
                final boolean openFired = fired;
                // Evidence of what the key tap actually produced.
                settle();
                dumpHierarchy("play-cache-open-hierarchy");
                snap("play-after-key");
                boolean sawDecrypting = false;
                boolean settledDeck = false;
                boolean midDumped = false;
                long watchStart = SystemClock.uptimeMillis();
                long deadline = watchStart + 45_000;
                while (SystemClock.uptimeMillis() < deadline) {
                    if (bodyContains("DECRYPTING")) {
                        sawDecrypting = true;
                    }
                    if (!bodyContains("DECRYPTING")
                            && (bodyContains("Collect") || bodyContains("Equip") || bodyContains("Salvage")
                            || bodyContains("Loot Secured"))) {
                        settledDeck = true;
                        break;
                    }
                    if (!midDumped && SystemClock.uptimeMillis() - watchStart > 12_000) {
                        // What does the reveal actually look like in
                        // the tree mid-flight? (Round 5's post-tap
                        // dump still showed the plain cache screen
                        // with a key already spent.)
                        midDumped = true;
                        dumpHierarchy("play-reveal-mid");
                    }
                    SystemClock.sleep(800);
                }
                if (!settledDeck) {
                    dumpHierarchy("play-reveal-end");
                }
                // Completion = a settled deck after a fired open.
                // (The probe may consume the brief DECRYPTING window
                // before the watch starts, so sawDecrypting alone
                // would under-report; openFired is the same evidence
                // one step earlier.)
                revealCompleted = settledDeck && (sawDecrypting || openFired);
                cacheNote = "openFired=" + openFired + " sawDecrypting=" + sawDecrypting + " settledDeck=" + settledDeck;
                snap("play-reveal");
            }
            // (No else: every keyClicked=false path above already
            // recorded its specific reason in cacheNote.)
            // Banked-loot proof (round 9): across rounds 5–8 the key
            // spend fires server-side but the reveal presentation
            // never enters this emulator's accessibility tree (the
            // same frozen-compositor condition that freezes its
            // screenshots). The player's outcome is still fully
            // observable as state: key balance down, inventory up.
            // If the key spends and the loot does NOT arrive, that
            // is a real defect and this stays red.
            int keysAfter = keysHeld();
            // Read the post-open loot count off a main tab's top
            // bar (round 9 tapped HOME but read before the bar
            // re-rendered — and possibly on the wrong screen).
            UiObject2 hunterTab = visibleFind("HUNTER", (int) (displayHeight * 0.85), displayHeight);
            if (hunterTab != null) {
                tapObject(hunterTab);
            }
            int lootAfter = -1;
            for (int i = 0; i < 20 && lootAfter < 0; i++) {
                lootAfter = lootCount();
                if (lootAfter < 0) SystemClock.sleep(600);
            }
            boolean banked = keysBefore >= 0 && keysAfter >= 0 && keysAfter < keysBefore
                    && lootBefore >= 0 && lootAfter > lootBefore;
            if (banked) {
                revealCompleted = true;
            }
            cacheNote = (cacheNote == null ? "" : cacheNote + " ")
                    + "keys " + keysBefore + "->" + keysAfter
                    + " loot " + lootBefore + "->" + lootAfter
                    + (banked ? " (banked-loot proof)" : "");
        }
        record("cacheOpened", cacheOpened, cacheNote);
        record("revealCompleted", revealCompleted, cacheNote);

        writeResult();
    }
}
