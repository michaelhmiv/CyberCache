package com.michaelhmiv.cybercache;

import static org.junit.Assert.assertTrue;

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
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Screen inventory crawl (on-demand harness — see docs/SCREEN_INVENTORY.md).
 *
 * Launches the real app, enters as a guest, captures the first-run starter
 * bundle reveal as its own named stop, dismisses it, then walks every
 * reachable screen, saving a screenshot + window-hierarchy dump per stop
 * and a manifest.json describing what was reached.
 *
 * Design contract (hardened after run 1, 2026-11-01 — run 1 reached only
 * 7 of 32 stops and 6 of those 7 captures were the wrong layer or the
 * wrong screen; see the PR that introduced this rewrite for the full
 * miss-by-miss diagnosis):
 *
 *  - VERIFIED FIND: every lookup goes through visibleFind(), which only
 *    accepts nodes whose visible bounds intersect the viewport inside a
 *    caller-specified vertical band, preferring clickable nodes and then
 *    the SHORTEST matching label (the most specific node). Selectors are
 *    the strings the WebView actually exposes: in this WebView aria
 *    labels surface as node TEXT (content-desc is empty), matching is
 *    case-sensitive, and tab nodes carry glyph + label ("▣ GEAR"), so
 *    contains-matching on the uppercase label inside the bottom band is
 *    the only reliable tab selector.
 *  - ANCHOR DISCIPLINE: before every stop the crawler returns to a known
 *    state — re-tap the stop's tab (verified against a tab-specific
 *    anchor), scroll to top (bounded), clear modal/sheet layers. A stop
 *    that fails is retried ONCE after re-anchoring; the manifest records
 *    the SECOND attempt's failure reason. One stop's failure can never
 *    cascade into the next stop's starting state.
 *  - MODAL GATE: a stop is only recorded "reached" when capture() has
 *    verified, at the capture instant, that (a) no modal/sheet layer is
 *    covering the screen — unless the modal/sheet IS the stop's named
 *    subject — and (b) the stop's own anchor element is visible in the
 *    viewport. A "reached" screenshot of the wrong layer is a miss.
 *    Run 1's board-home capture showed the "Loot Secured" reveal modal
 *    over a blurred Board and counted as reached; that class of false
 *    positive is what this gate exists to prevent.
 *  - SCROLL-SEARCH: below-the-fold targets are found with a bounded
 *    swipe-and-scan loop (never a fixed scroll count); when a target
 *    took >0 swipes, the manifest note says how many.
 *  - The test fails only when the app does not launch, the guest entry
 *    never renders, or the guest Board (home) never verifies. Deep-stop
 *    misses are manifest data; the WORKFLOW fails the run when fewer
 *    than MIN_REACHED_STOPS of the stops are reached (see
 *    .github/workflows/screen-inventory.yml).
 *  - The crawl never buys, sells, salvages, or starts a boss fight. It
 *    does claim the starter bundle ("Collect") and may start roaming /
 *    switch the current action on the throwaway guest account — the same
 *    state changes a first-run user makes in their first minutes.
 *
 * Output lands in the app's external files dir under "screen-inventory"
 * (/sdcard/Android/data/com.michaelhmiv.cybercache/files/screen-inventory),
 * which the screen-inventory workflow pulls with adb after the run.
 * manifest.json is rewritten after every stop, so a partial crawl still
 * leaves a truthful manifest behind.
 */
@RunWith(AndroidJUnit4.class)
public class ScreenInventoryTest {

    private static final String TAG = "ScreenInventory";
    private static final String PACKAGE = "com.michaelhmiv.cybercache";
    private static final String OUT_DIR_NAME = "screen-inventory";

    /** Waits. The WebView accessibility tree lags the visual state, so
     *  transitions get generous polls; every wait is a poll loop, never a
     *  bare sleep-then-check. */
    private static final long NAV_WAIT_MS = 12000;
    private static final long SHEET_WAIT_MS = 10000;
    private static final long POLL_MS = 500;

    /** Bottom-nav labels as exposed in the tree (glyph + label, one node). */
    private static final String TAB_BOARD = "BOARD";
    private static final String TAB_ACTION = "ACTION";
    private static final String TAB_GEAR = "GEAR";
    private static final String TAB_MARKET = "MARKET";
    private static final String TAB_RANK = "RANK";
    private static final String TAB_HUNTER = "HUNTER";

    /** In-screen Gear tab labels (deny-list for grid row taps). */
    private static final Set<String> GEAR_TAB_LABELS = new HashSet<>(Arrays.asList(
            "Loadout", "Gear", "Items", "Workshop"));

    private UiDevice device;
    private File outDir;
    private boolean internalStorageFallback = false;
    private int displayWidth;
    private int displayHeight;
    private int shotSeq = 0;
    private final List<String> manifestEntries = new ArrayList<>();

    /** Failure reason set by the most recent failed helper inside a stop. */
    private String lastFail = null;
    /** Set by boss-select when it leaves the boss picker open for boss-prep. */
    private boolean bossPickerOpen = false;

    @Before
    public void setUp() throws Exception {
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
            internalStorageFallback = true;
        }
        if (!outDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            outDir.mkdirs();
        }
        Log.i(TAG, "Output dir: " + outDir.getAbsolutePath());
    }

    // ------------------------------------------------------------------
    // Small primitives
    // ------------------------------------------------------------------

    private void settle() {
        device.waitForIdle(3000);
        SystemClock.sleep(1200);
    }

    private void settleLong() {
        device.waitForIdle(5000);
        SystemClock.sleep(2200);
    }

    private int y(double fraction) {
        return (int) (displayHeight * fraction);
    }

    // ------------------------------------------------------------------
    // Verified find — the ONLY way stops look anything up.
    //
    // Run-1 lessons baked in: (1) hierarchy dumps in this WebView omit
    // modal/sheet subtrees and lag the visual state, so presence in a
    // dump was never proof of visibility — every find here goes through
    // live queries and viewport-bounds filtering; (2) content-desc is
    // empty for WebView content (aria surfaces as text), so text is
    // searched first and desc only as a fallback; (3) matching is
    // case-sensitive and labels are often uppercase or glyph-prefixed,
    // so needles are the exact exposed strings.
    // ------------------------------------------------------------------

    /** Pick the best node among candidates: bounds must intersect the
     *  viewport with centerY inside [minY, maxY]; clickable wins, then
     *  the shortest label (most specific node — e.g. the "▣ GEAR" tab
     *  node over a long hub row that also contains "GEAR"). */
    private UiObject2 pickVisible(List<UiObject2> objs, int minY, int maxY) {
        if (objs == null) {
            return null;
        }
        UiObject2 best = null;
        int bestLen = Integer.MAX_VALUE;
        boolean bestClickable = false;
        for (UiObject2 o : objs) {
            try {
                Rect b = o.getVisibleBounds();
                if (b == null) {
                    continue;
                }
                if (b.bottom <= 0 || b.top >= displayHeight) {
                    continue; // fully off-screen remnant
                }
                int cy = b.centerY();
                if (cy < minY || cy > maxY) {
                    continue;
                }
                String label = o.getText();
                if (label == null) {
                    label = o.getContentDescription();
                }
                int len = label == null ? Integer.MAX_VALUE - 1 : label.length();
                boolean clickable = false;
                try {
                    clickable = o.isClickable();
                } catch (Exception ignored) {
                    // Treat as non-clickable.
                }
                if (best == null
                        || (clickable && !bestClickable)
                        || (clickable == bestClickable && len < bestLen)) {
                    best = o;
                    bestLen = len;
                    bestClickable = clickable;
                }
            } catch (Exception ignored) {
                // Stale node — skip.
            }
        }
        return best;
    }

    /** Verified find within a vertical band (pixel bounds). */
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
        return visibleFind(needle, 0, y(0.45));
    }

    /** Verified find in the body region (below headers, above the tab bar). */
    private UiObject2 vfBody(String needle) {
        return visibleFind(needle, y(0.08), y(0.88));
    }

    /** Verified find of a LARGE node (screen titles are set in a display
     *  face; tab labels and rows are not). Used where a stop's title text
     *  is identical to the label of the control that opened it. */
    private UiObject2 vfLarge(String needle, int minHeightPx) {
        List<UiObject2> objs = device.findObjects(By.textContains(needle));
        if (objs == null) {
            return null;
        }
        for (UiObject2 o : objs) {
            try {
                Rect b = o.getVisibleBounds();
                if (b != null && b.height() >= minHeightPx && b.centerY() < y(0.40)) {
                    return o;
                }
            } catch (Exception ignored) {
                // Stale node — skip.
            }
        }
        return null;
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
            SystemClock.sleep(POLL_MS);
        }
    }

    /** Poll until none of the needles is visibly present. */
    private boolean waitGone(long timeoutMs, String... needles) {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (true) {
            boolean any = false;
            for (String n : needles) {
                if (vf(n) != null) {
                    any = true;
                    break;
                }
            }
            if (!any) {
                return true;
            }
            if (SystemClock.uptimeMillis() >= deadline) {
                return false;
            }
            SystemClock.sleep(POLL_MS);
        }
    }

    /** Tap the verified node for a needle (body region by default). */
    private boolean tapVisible(String needle) {
        UiObject2 o = vfBody(needle);
        if (o == null) {
            o = vf(needle);
        }
        if (o == null) {
            return false;
        }
        o.click();
        settle();
        return true;
    }

    // ------------------------------------------------------------------
    // Scrolling — swipe-and-scan, never fixed counts.
    // ------------------------------------------------------------------

    private void swipeDown() {
        device.swipe(displayWidth / 2, y(0.72), displayWidth / 2, y(0.30), 22);
        SystemClock.sleep(700);
    }

    private void swipeUp() {
        device.swipe(displayWidth / 2, y(0.30), displayWidth / 2, y(0.75), 22);
        SystemClock.sleep(500);
    }

    /**
     * Scroll-search: scan, swipe, scan … up to maxSwipes.
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

    /** Bounded scroll to top; stops early when the anchor is visible. */
    private void scrollToTop(String anchor) {
        for (int i = 0; i < 5; i++) {
            if (anchor != null && vf(anchor) != null) {
                return;
            }
            swipeUp();
        }
    }

    private String swipeNote(int swipes) {
        return swipes > 0 ? " Found after " + swipes + " scroll swipe" + (swipes == 1 ? "" : "s") + "." : "";
    }

    // ------------------------------------------------------------------
    // Modal / sheet gate
    // ------------------------------------------------------------------

    /** Sheet titles/details that only exist while that sheet is open.
     *  ("Switch Action" is deliberately absent: the button that opens the
     *  switcher carries the same text as its sheet title — the sheet is
     *  detected by its detail line instead.) */
    private boolean sheetOpen() {
        return vf("Choose Area") != null
                || vf("Choose Boss Target") != null
                || vf("Broad action changes live in this drawer") != null
                || vf("Market Intelligence") != null
                || vf("Salvage Forecast") != null;
    }

    /** Name of a modal layer covering the screen, or null. Modal controls
     *  are checked against live queries; run 1 proved the starter reveal
     *  can be visually present while absent from hierarchy DUMPS, which
     *  is why the reveal stop additionally has a behavioral probe. */
    private String modalPresent() {
        if (vf("Collect") != null) {
            return "Collect (loot reveal)";
        }
        if (vf("Got it") != null) {
            return "Got it (offline recap)";
        }
        if (vf("Loot Secured") != null) {
            return "Loot Secured (loot reveal)";
        }
        if (sheetOpen()) {
            return "a bottom sheet";
        }
        return null;
    }

    /** Dismiss a bottom sheet by tapping the scrim near the top. */
    private void closeSheet() {
        device.click(displayWidth / 2, y(0.07));
        settle();
    }

    /**
     * Clear any modal/sheet layer: claim a loot reveal, accept a recap,
     * or scrim-close a sheet. Bounded at 3 rounds. Runs at every stop's
     * anchor step and is re-checked inside capture().
     */
    private void clearModals() {
        for (int i = 0; i < 3; i++) {
            UiObject2 collect = vf("Collect");
            if (collect != null) {
                collect.click();
                settle();
                continue;
            }
            UiObject2 gotIt = vf("Got it");
            if (gotIt != null) {
                gotIt.click();
                settle();
                continue;
            }
            UiObject2 dismiss = device.findObject(By.desc("Dismiss"));
            if (dismiss == null) {
                dismiss = vf("Dismiss");
            }
            if (dismiss != null && sheetOpen()) {
                dismiss.click();
                settle();
                continue;
            }
            if (sheetOpen()) {
                closeSheet();
                continue;
            }
            return;
        }
    }

    // ------------------------------------------------------------------
    // Tab anchoring — the known state every stop starts from.
    // ------------------------------------------------------------------

    /** Tab-specific verification anchors (what proves the tab rendered). */
    private String[] tabAnchors(String tab) {
        switch (tab) {
            case TAB_BOARD:
                return new String[]{"Current area:"};
            case TAB_ACTION:
                return new String[]{"Switch Action"};
            case TAB_GEAR:
                return new String[]{"Loadout", "Workshop"};
            case TAB_MARKET:
                return new String[]{"Vendor", "Buy"};
            case TAB_RANK:
                return new String[]{"Leaderboards"};
            case TAB_HUNTER:
                return new String[]{"Trophy Shelf"};
            default:
                return new String[0];
        }
    }

    /** The tab node: contains-match on the uppercase label, restricted to
     *  the bottom band, shortest label wins (tab node vs hub rows). */
    private UiObject2 findTabNode(String tab) {
        return visibleFind(tab, y(0.86), displayHeight);
    }

    /**
     * Tap a bottom tab and VERIFY the tab's screen rendered. One re-tap
     * on verification failure (the tree lags), one system-back recovery
     * if the tab bar itself is unreachable (a sub-screen is covering it).
     */
    private boolean tapTabVerified(String tab) {
        String[] anchors = tabAnchors(tab);
        for (int attempt = 0; attempt < 3; attempt++) {
            UiObject2 node = findTabNode(tab);
            if (node == null) {
                if (attempt == 1) {
                    // Probably standing on a sub-screen without a tab
                    // bar — step back once and look again.
                    try {
                        device.pressBack();
                    } catch (Exception ignored) {
                        // Best effort recovery.
                    }
                    settle();
                } else {
                    SystemClock.sleep(800);
                }
                continue;
            }
            node.click();
            settle();
            if (waitVisible(NAV_WAIT_MS, anchors) != null) {
                return true;
            }
            // Anchor not verified — the tap may have landed while the
            // tree was stale; loop re-finds and re-taps once.
        }
        return waitVisible(3000, anchors) != null;
    }

    /**
     * Return to a known state for a stop on the given tab: verified tab
     * tap, bounded scroll to top, modal layers cleared. With
     * preserveOverlays the tab is NOT re-tapped and nothing is cleared —
     * used only by boss-prep, which continues from the picker that
     * boss-select deliberately left open.
     */
    private boolean anchorToTab(String tab, boolean preserveOverlays) {
        if (preserveOverlays) {
            return true;
        }
        boolean ok = tapTabVerified(tab);
        String[] anchors = tabAnchors(tab);
        scrollToTop(anchors.length > 0 ? anchors[0] : null);
        clearModals();
        return ok;
    }

    /** Tap the sub-screen "Back" affordance (top region), else system back. */
    private boolean tapBack() {
        UiObject2 back = visibleFind("Back", 0, y(0.25));
        if (back != null) {
            back.click();
            settle();
            return true;
        }
        try {
            device.pressBack();
            settle();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void ensureForeground() {
        try {
            String pkg = device.getCurrentPackageName();
            if (!PACKAGE.equals(pkg)) {
                launchApp();
            }
        } catch (Exception ignored) {
            // If the check itself fails, navigation attempts will surface it.
        }
    }

    private void launchApp() {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent intent = target.getPackageManager().getLaunchIntentForPackage(PACKAGE);
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
            target.startActivity(intent);
        }
        settleLong();
    }

    /**
     * Find (without tapping) the first plausible list row: a wide,
     * clickable, text-bearing node in the body band that is not in the
     * caller's deny-list. Used for the boss picker rows and gear-grid
     * item cards, whose labels are generated content the crawl cannot
     * know in advance.
     */
    private UiObject2 findFirstRow(Set<String> deny) {
        List<UiObject2> objs = device.findObjects(By.clickable(true));
        if (objs == null || objs.isEmpty()) {
            objs = device.findObjects(By.clazz("android.widget.Button"));
        }
        if (objs == null) {
            return null;
        }
        UiObject2 best = null;
        int bestTop = Integer.MAX_VALUE;
        for (UiObject2 o : objs) {
            try {
                Rect b = o.getVisibleBounds();
                if (b == null) {
                    continue;
                }
                String text = o.getText();
                if (text == null || text.trim().isEmpty()) {
                    text = o.getContentDescription();
                }
                if (text == null || text.trim().length() < 3) {
                    continue;
                }
                text = text.trim();
                if (deny.contains(text)) {
                    continue;
                }
                int cy = b.centerY();
                if (cy < y(0.14) || cy > y(0.88)) {
                    continue;
                }
                if (b.width() < displayWidth * 0.42) {
                    continue;
                }
                if (b.top < bestTop) {
                    bestTop = b.top;
                    best = o;
                }
            } catch (Exception ignored) {
                // Stale node — skip.
            }
        }
        return best;
    }

    private boolean tapFirstRow(Set<String> deny) {
        UiObject2 row = findFirstRow(deny);
        if (row == null) {
            return false;
        }
        row.click();
        settleLong();
        return true;
    }

    // ------------------------------------------------------------------
    // Capture + manifest
    // ------------------------------------------------------------------

    private String jsonEscape(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: sb.append(c);
            }
        }
        return sb.toString();
    }

    private void flushManifest() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n  \"generatedBy\": \"ScreenInventoryTest\",\n");
        sb.append("  \"package\": \"").append(PACKAGE).append("\",\n");
        sb.append("  \"entries\": [\n");
        for (int i = 0; i < manifestEntries.size(); i++) {
            sb.append(manifestEntries.get(i));
            sb.append(i < manifestEntries.size() - 1 ? ",\n" : "\n");
        }
        sb.append("  ]\n}\n");
        File manifest = new File(outDir, "manifest.json");
        FileWriter w = null;
        try {
            w = new FileWriter(manifest);
            w.write(sb.toString());
            w.flush();
        } catch (IOException e) {
            Log.e(TAG, "Failed to write manifest", e);
        } finally {
            if (w != null) {
                try {
                    w.close();
                } catch (IOException ignored) {
                    // Nothing useful to do.
                }
            }
        }
    }

    private void record(String file, String screen, boolean reached, String note) {
        String entry = "    {\"file\": \"" + jsonEscape(file)
                + "\", \"screen\": \"" + jsonEscape(screen)
                + "\", \"reached\": " + reached
                + ", \"note\": \"" + jsonEscape(note) + "\"}";
        manifestEntries.add(entry);
        flushManifest();
        Log.i(TAG, "Inventory: " + screen + " reached=" + reached + " file=" + file + " — " + note);
    }

    /** Screenshot + hierarchy dump WITHOUT recording (evidence shots). */
    private String snapRaw(String screen) {
        settle();
        shotSeq++;
        String base = String.format(Locale.US, "%02d-%s", shotSeq, screen);
        File png = new File(outDir, base + ".png");
        File xml = new File(outDir, base + ".xml");
        try {
            device.takeScreenshot(png);
        } catch (Exception e) {
            Log.e(TAG, "takeScreenshot failed for " + screen, e);
        }
        try {
            FileOutputStream out = new FileOutputStream(xml);
            device.dumpWindowHierarchy(out);
            out.flush();
            out.close();
        } catch (Exception e) {
            Log.e(TAG, "dumpWindowHierarchy failed for " + screen, e);
        }
        return base + ".png";
    }

    /** Settle, screenshot, dump hierarchy, record a reached stop. */
    private void snap(String screen, String note) {
        String file = snapRaw(screen);
        record(file, screen, true,
                note + (internalStorageFallback ? " (internal-storage fallback dir)" : ""));
    }

    private void miss(String screen, String reason) {
        record("", screen, false, reason);
    }

    /**
     * THE capture gate. Records the stop as reached only when, at the
     * capture instant:
     *  (a) no modal/sheet layer covers the screen — skipped when the
     *      modal/sheet IS this stop's named subject (modalSubject), and
     *  (b) at least one of the stop's own anchors is verified visible.
     * On failure nothing is recorded; lastFail carries the reason and the
     * stop runner decides between retry and miss. A screenshot of the
     * wrong layer is never recorded as reached.
     */
    private boolean capture(String screen, String note, boolean modalSubject, String... anchors) {
        if (!modalSubject) {
            String modal = modalPresent();
            if (modal != null) {
                lastFail = "a modal/sheet layer (" + modal + ") covered the screen at capture time";
                return false;
            }
        }
        String found = null;
        for (String a : anchors) {
            if (vf(a) != null) {
                found = a;
                break;
            }
        }
        if (found == null) {
            StringBuilder tried = new StringBuilder();
            for (int i = 0; i < anchors.length; i++) {
                if (i > 0) {
                    tried.append(", ");
                }
                tried.append('\'').append(anchors[i]).append('\'');
            }
            lastFail = "stop anchor not visible at capture (tried: " + tried + ")";
            return false;
        }
        snap(screen, note + " [anchor verified in viewport: '" + found + "']");
        return true;
    }

    private interface StopBody {
        /** Returns true when the stop was captured (recorded reached). */
        boolean run() throws Exception;
    }

    /**
     * Run one crawl stop with anchor discipline + one retry. Attempt 1
     * runs from a freshly anchored state; on failure the stop is
     * re-anchored and retried once; the manifest records the SECOND
     * attempt's failure reason. A stop never throws out of here.
     */
    private void stop(String screen, String tab, boolean preserveOverlays, StopBody body) {
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                ensureForeground();
                if (tab != null) {
                    anchorToTab(tab, preserveOverlays);
                }
                lastFail = null;
                if (body.run()) {
                    return;
                }
                if (attempt == 2) {
                    miss(screen, "Attempt 2: " + (lastFail != null
                            ? lastFail
                            : "stop reported failure without a specific reason"));
                }
            } catch (Throwable t) {
                Log.e(TAG, "Stop failed: " + screen + " (attempt " + attempt + ")", t);
                lastFail = "exception during crawl stop: " + t.getClass().getSimpleName()
                        + ": " + String.valueOf(t.getMessage());
                if (attempt == 2) {
                    miss(screen, "Attempt 2: " + lastFail);
                }
            }
        }
    }

    private void stop(String screen, String tab, StopBody body) {
        stop(screen, tab, false, body);
    }

    // ------------------------------------------------------------------
    // First-run surfaces: the starter bundle reveal is a NAMED stop.
    // ------------------------------------------------------------------

    /** Dismiss the starter reveal via its real controls; verify gone. */
    private void dismissReveal() {
        for (int i = 0; i < 3; i++) {
            UiObject2 collect = vf("Collect");
            if (collect != null) {
                collect.click();
                settle();
                continue;
            }
            UiObject2 dismiss = device.findObject(By.desc("Dismiss"));
            if (dismiss == null) {
                dismiss = vf("Dismiss");
            }
            if (dismiss != null) {
                dismiss.click();
                settle();
                continue;
            }
            break;
        }
        waitGone(8000, "Collect", "Loot Secured", "Starter supply drop");
    }

    /**
     * Behavioral interactivity probe: tap the Board's current-area chip
     * and see whether the "Choose Area" picker actually opens. Run 1
     * proved this WebView's hierarchy dumps can omit a covering modal
     * entirely — presence of Board anchors in the tree is NOT proof the
     * Board is uncovered, but a picker opening in response to a tap is.
     * Closes the picker again when it opened.
     */
    private boolean probeBoardInteractive() {
        UiObject2 chip = vfTop("Current area:");
        if (chip == null) {
            return false;
        }
        chip.click();
        settle();
        boolean opened = waitVisible(6000, "Choose Area") != null;
        if (opened) {
            closeSheet();
            waitGone(4000, "Choose Area");
        }
        return opened;
    }

    /**
     * The starter-bundle-reveal stop, run immediately after guest entry.
     * Three outcomes, all recorded honestly:
     *  1. The reveal's controls appear in live queries → capture it as
     *     the named modal stop, then dismiss via Collect.
     *  2. They never appear AND the Board probe passes → the reveal did
     *     not render this run; recorded as a miss saying exactly that.
     *  3. They never appear AND the probe fails → a covering layer is
     *     behaviorally certain (Board anchors are in the tree but taps
     *     do nothing — run 1's exact failure). The current screen is
     *     captured AS this stop (the modal is its subject), then the
     *     reveal is dismissed with a last-resort bounds-relative tap on
     *     the Collect position measured from run 1's PNGs
     *     (x ≈ 0.47W, y ≈ 0.91H), flagged in the note as such.
     */
    private void starterRevealStop() {
        String hit = waitVisible(30000, "Collect", "Loot Secured", "Starter supply drop");
        if (hit != null) {
            if (capture("starter-bundle-reveal",
                    "Starter Supply Drop reveal ('Loot Secured') — the first-run loot moment, "
                            + "captured as its own named stop BEFORE dismissal so no later stop "
                            + "can inherit it as a covering layer.",
                    true, "Collect", "Loot Secured", "Starter supply drop")) {
                dismissReveal();
                return;
            }
            miss("starter-bundle-reveal",
                    "Reveal anchor '" + hit + "' appeared but capture verification failed: " + lastFail);
            dismissReveal();
            return;
        }
        if (probeBoardInteractive()) {
            miss("starter-bundle-reveal",
                    "Reveal controls never surfaced in live accessibility queries within 30s of "
                            + "guest entry, and the Board interactivity probe PASSED (area chip "
                            + "opened 'Choose Area'), so no covering modal was present — the "
                            + "starter reveal did not render on this run.");
            return;
        }
        // Case 3: tree-invisible covering modal (run 1's poison).
        String file = snapRaw("starter-bundle-reveal");
        record(file, "starter-bundle-reveal", true,
                "Reveal controls never surfaced in live accessibility queries, and the Board "
                        + "interactivity probe FAILED (area chip did not open 'Choose Area') — a "
                        + "covering modal is behaviorally certain (run 1 proved this WebView's "
                        + "hierarchy omits modal subtrees). This screenshot is that modal, "
                        + "captured as the stop's named subject. Dismissal used a LAST-RESORT "
                        + "bounds-relative tap on the Collect position measured from run 1's "
                        + "captures (0.47W, 0.91H), flagged here per harness rules.");
        device.click((int) (displayWidth * 0.47), y(0.912));
        settleLong();
        if (!probeBoardInteractive()) {
            Log.w(TAG, "Board still non-interactive after bounds-tap dismissal; "
                    + "board-home will fail honestly rather than capture the modal.");
        }
    }

    // ------------------------------------------------------------------
    // Shared navigation fragments
    // ------------------------------------------------------------------

    /** Open the Switch Action sheet and verify it (sheet detail line or
     *  a row only the sheet carries). */
    private boolean openSwitcher() {
        if (sheetOpen() && vf("Broad action changes live in this drawer") != null) {
            return true;
        }
        if (!tapVisible("Switch Action")) {
            lastFail = "'Switch Action' button not found on the Action tab";
            return false;
        }
        if (waitVisible(SHEET_WAIT_MS, "Broad action changes live in this drawer", "Boss Prep") == null) {
            lastFail = "Switch Action sheet did not open (neither its detail line nor its rows appeared)";
            return false;
        }
        return true;
    }

    /**
     * Open the boss target picker. Route A: the Action screen's own
     * "Choose Boss" section button → the "Choose Boss Target" sheet.
     * Route B: Switch Action sheet → "Boss Prep" row (its detail reads
     * 'Choose target'). Route C: the Board diorama node ("CHOOSE BOSS
     * Open Action target picker") → BossSelectModal. On success the
     * picker is LEFT OPEN (boss-prep continues from it) and the route
     * that worked is in bossRoute.
     */
    private String bossRoute = null;

    private boolean openBossPicker() {
        if (bossPickerOpen && vf("Choose Boss Target") != null) {
            return true;
        }
        bossPickerOpen = false;
        // Route A — Action screen boss section.
        anchorToTab(TAB_ACTION, false);
        if (scrollSearch(4, "Choose Boss") >= 0 && tapVisible("Choose Boss")) {
            if (waitVisible(SHEET_WAIT_MS, "Choose Boss Target") != null) {
                bossPickerOpen = true;
                bossRoute = "Action screen 'Choose Boss' button";
                return true;
            }
            closeSheet();
        }
        // Route B — switcher "Boss Prep" row.
        scrollToTop("Switch Action");
        if (openSwitcher() && tapVisible("Boss Prep")) {
            if (waitVisible(SHEET_WAIT_MS, "Choose Boss Target") != null) {
                bossPickerOpen = true;
                bossRoute = "Switch Action sheet 'Boss Prep' row";
                return true;
            }
            closeSheet();
        }
        // Route C — Board diorama.
        anchorToTab(TAB_BOARD, false);
        UiObject2 diorama = vf("CHOOSE BOSS");
        if (diorama != null) {
            diorama.click();
            settleLong();
            if (waitVisible(SHEET_WAIT_MS, "Choose Boss Target") != null) {
                bossPickerOpen = true;
                bossRoute = "Board diorama 'CHOOSE BOSS'";
                return true;
            }
            closeSheet();
        }
        lastFail = "no route opened the 'Choose Boss Target' picker (tried: Action 'Choose Boss' "
                + "button, switcher 'Boss Prep' row, Board diorama 'CHOOSE BOSS')";
        return false;
    }

    /** Tap an in-screen tab on the Gear screen (top region, exact-ish). */
    private boolean tapGearTab(String label) {
        UiObject2 o = vfTop(label);
        if (o == null) {
            lastFail = "Gear in-screen tab '" + label + "' not found in the top region";
            return false;
        }
        o.click();
        settleLong();
        return true;
    }

    /** The Market tab row can overflow horizontally — swipe it to reveal a tab. */
    private void revealMarketTab(String label) {
        if (vfTop(label) != null) {
            return;
        }
        UiObject2 vendor = vfTop("Vendor");
        int yy = vendor != null ? vendor.getVisibleBounds().centerY() : y(0.16);
        for (int i = 0; i < 3 && vfTop(label) == null; i++) {
            device.swipe((int) (displayWidth * 0.85), yy, (int) (displayWidth * 0.25), yy, 16);
            SystemClock.sleep(600);
        }
    }

    /** Tap a Market tab (top region) after revealing it if needed. */
    private boolean tapMarketTab(String label) {
        revealMarketTab(label);
        UiObject2 o = vfTop(label);
        if (o == null) {
            lastFail = "Market tab '" + label + "' not found even after revealing the tab row";
            return false;
        }
        o.click();
        settleLong();
        return true;
    }

    // ------------------------------------------------------------------
    // The crawl
    // ------------------------------------------------------------------

    @Test
    public void crawlAllScreens() {
        // ---- Launch + guest entry (hard-failure section) ----
        launchApp();
        // Cold-start budget: on a freshly booted emulator the first paint
        // waits on WebView init + bundle load + the session check against
        // the live Chef. The original 45s auth wait proved too short in
        // exactly that environment (the class's accidental per-PR run on
        // PR #251 died here at 53s) — allow 120s, and accept either auth
        // affordance OR an already-live session (Board area chip) as
        // "the app painted".
        String firstPaint = waitVisible(120000,
                "Continue as Guest", "Sign in with Google", "Current area:");
        if (firstPaint == null) {
            // Capture what WAS on screen before failing, so a launch
            // failure is diagnosable from the artifact (white WebView?
            // splash? error boundary?) instead of a bare assertion.
            String evidence = snapRaw("launch-failure");
            record(evidence, "auth", false,
                    "Neither the auth screen nor a live session rendered within 120s of launch."
                            + " Evidence screenshot + hierarchy captured as " + evidence + ".");
            flushManifest();
            assertTrue("App did not reach the auth screen or a live session after launch", false);
        }
        boolean authSeen = "Continue as Guest".equals(firstPaint) || "Sign in with Google".equals(firstPaint);
        if (authSeen) {
            snap("auth", "Auth screen as launched: Sign in with Google + Continue as Guest (the only two entries by design).");
            boolean tapped = tapVisible("Continue as Guest");
            assertTrue("Guest entry button was visible but could not be tapped", tapped);
            settleLong();
        }
        // The Board must render (its anchors may sit UNDER the starter
        // reveal — run 1's dumps contained Board content beneath the
        // modal — so this only proves render, not interactivity; the
        // reveal protocol and board-home's capture gate prove the rest).
        if (waitVisible(60000, "Current area:") == null) {
            record("", "board-home", false, "Guest Board never rendered after guest entry.");
            flushManifest();
            assertTrue("Guest home (Board) never rendered", false);
        }

        // ---- Stop 2: the starter reveal, named and gated ----
        starterRevealStop();

        // ---- Stop 3: Board home — anchor-verified, modal-gated ----
        boolean homeOk = false;
        for (int attempt = 1; attempt <= 2 && !homeOk; attempt++) {
            anchorToTab(TAB_BOARD, false);
            lastFail = null;
            homeOk = capture("board-home",
                    "Board (Dashboard) top: resource bar, current-area chip, DashboardTopBar "
                            + "(level badge + XP bar, streak/contracts icon buttons), area diorama.",
                    false, "Current area:", "HUNTER TOTALS", "ACTION BOARD");
        }
        if (!homeOk) {
            miss("board-home", "Attempt 2: " + (lastFail != null ? lastFail : "capture gate failed"));
            flushManifest();
            assertTrue("Guest home (Board) rendered but never passed the modal/anchor capture gate", false);
        }

        // ---- BOARD deep stops ----
        stop("board-area-picker", TAB_BOARD, () -> {
            UiObject2 chip = vfTop("Current area:");
            if (chip == null) {
                lastFail = "current-area chip ('Current area:' aria node) not found at the Board top";
                return false;
            }
            chip.click();
            settle();
            if (waitVisible(SHEET_WAIT_MS, "Choose Area") == null) {
                lastFail = "area picker sheet ('Choose Area') did not open from the current-area chip";
                closeSheet();
                return false;
            }
            boolean ok = capture("board-area-picker",
                    "Area picker (PickerSheet 'Choose Area') opened from the Board's current-area chip: the 7 roaming areas with unlock levels.",
                    true, "Choose Area");
            closeSheet();
            waitGone(4000, "Choose Area");
            return ok;
        });

        stop("board-panels", TAB_BOARD, () -> {
            int swipes = scrollSearch(4, "ACTION BOARD", "HUNTER TOTALS");
            if (swipes < 0) {
                lastFail = "neither 'ACTION BOARD' nor 'HUNTER TOTALS' entered the viewport within 4 scroll swipes";
                return false;
            }
            return capture("board-panels",
                    "Board scrolled: the ACTION BOARD nav rows (Roaming / Loadout Bench / Crack Cache / Skill Trees / Workshop / Dispatch) and HUNTER TOTALS region."
                            + swipeNote(swipes),
                    false, "ACTION BOARD", "HUNTER TOTALS");
        });

        stop("settings", TAB_BOARD, () -> {
            int swipes = scrollSearch(6, "SETTINGS");
            if (swipes < 0) {
                lastFail = "Board nav row 'SETTINGS' not found within 6 scroll swipes (rows render only when scrolled near)";
                return false;
            }
            if (!tapVisible("SETTINGS")) {
                lastFail = "'SETTINGS' nav row found but not tappable";
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Options Board") == null) {
                lastFail = "Settings screen ('Options Board') did not render after tapping the SETTINGS row";
                tapBack();
                return false;
            }
            boolean ok = capture("settings",
                    "Settings screen ('Options Board') from the Board nav row — preferences, display, and local save controls." + swipeNote(swipes),
                    false, "Options Board");
            tapBack();
            return ok;
        });

        stop("crack-cache", TAB_BOARD, () -> {
            int swipes = scrollSearch(6, "CRACK CACHE");
            if (swipes < 0) {
                lastFail = "Board nav row 'CRACK CACHE' not found within 6 scroll swipes";
                return false;
            }
            if (!tapVisible("CRACK CACHE")) {
                lastFail = "'CRACK CACHE' nav row found but not tappable";
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Data Cache") == null) {
                lastFail = "Cache lane ('Data Cache') did not render after tapping the CRACK CACHE row";
                tapBack();
                return false;
            }
            boolean ok = capture("crack-cache",
                    "Cache lane (ChestScreen, heading 'Data Cache'): the daily cache-box budget — 1 free box, then key/ad openings to the 10/day cap." + swipeNote(swipes),
                    false, "Data Cache");
            tapBack();
            return ok;
        });

        stop("dispatch", TAB_BOARD, () -> {
            int swipes = scrollSearch(6, "DISPATCH");
            if (swipes < 0) {
                lastFail = "Board nav row 'DISPATCH' not found within 6 scroll swipes";
                return false;
            }
            if (!tapVisible("DISPATCH")) {
                lastFail = "'DISPATCH' nav row found but not tappable";
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Dispatch Bay", "Contract Board") == null) {
                lastFail = "Dispatch board ('Dispatch Bay' / 'Contract Board — today') did not render after tapping the DISPATCH row";
                tapBack();
                return false;
            }
            boolean ok = capture("dispatch",
                    "Dispatch board: timed contracts for spare loadouts and spare vehicles (dispatch runs parallel to the personal action slot)." + swipeNote(swipes),
                    false, "Dispatch Bay", "Contract Board");
            tapBack();
            return ok;
        });

        // ---- ACTION ----
        stop("action-main", TAB_ACTION, () -> capture("action-main",
                "Action tab as a fresh guest finds it: standby state, action stage, vehicle line, loadout strip, feed — verified by the real 'Switch Action' button in the viewport.",
                false, "Switch Action"));

        stop("action-roaming", TAB_ACTION, () -> {
            if (!tapVisible("Start Roam") && !tapVisible("START ROAM")) {
                lastFail = "no roaming start control found (tried the standby card's 'Start Roam' and the diorama's 'START ROAM' aria node)";
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Roaming Loot", "Sweeping the area") == null) {
                lastFail = "roaming state never verified after tapping start (stage title 'Roaming Loot' / its detail line never appeared)";
                return false;
            }
            return capture("action-roaming",
                    "Roaming live: the tick loop running in the starter area (Dustwaste Frontier), verified by the stage's 'Roaming Loot' state — not by the tap alone.",
                    false, "Roaming Loot", "Sweeping the area");
        });

        stop("action-switcher", TAB_ACTION, () -> {
            if (!openSwitcher()) {
                return false;
            }
            boolean ok = capture("action-switcher",
                    "Switch Action sheet (ContextualPickerSheet): the one-action-at-a-time list — Roam / Boss Prep / Boss Fight / Endless / Extract / Craft / Salvage.",
                    true, "Broad action changes live in this drawer", "Boss Prep");
            closeSheet();
            return ok;
        });

        stop("action-extraction", TAB_ACTION, () -> {
            if (!openSwitcher()) {
                return false;
            }
            if (!tapVisible("Extract")) {
                lastFail = "'Extract' row not found in the Switch Action sheet";
                closeSheet();
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Deep Delve", "Surface Sweep") == null) {
                lastFail = "Extraction panel did not render after tapping 'Extract' (its 'Deep Delve' / 'Surface Sweep' site anchors never appeared)";
                return false;
            }
            return capture("action-extraction",
                    "Extraction panel: dig-site passes (Surface Sweep / Deep Delve) — the extraction occupation surface.",
                    false, "Deep Delve", "Surface Sweep", "Extraction");
        });

        stop("action-crafting", TAB_ACTION, () -> {
            if (!openSwitcher()) {
                return false;
            }
            if (!tapVisible("Craft")) {
                lastFail = "'Craft' row not found in the Switch Action sheet";
                closeSheet();
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Recipe Control", "Bench output forecast", "Bench Jobs") == null) {
                lastFail = "Crafting panel did not render after tapping 'Craft' (Recipe Control / bench anchors never appeared)";
                return false;
            }
            return capture("action-crafting",
                    "Crafting panel on the Action tab: bench jobs + Recipe Control (crafting needs no verified account — guests craft).",
                    false, "Recipe Control", "Bench output forecast", "Bench Jobs");
        });

        // ---- Boss select + prep (prep continues from the open picker) ----
        stop("boss-select", TAB_ACTION, () -> {
            if (!openBossPicker()) {
                return false;
            }
            boolean ok = capture("boss-select",
                    "Boss target picker ('Choose Boss Target' sheet) via " + bossRoute + ". Rows are intel-only by design — no win-chance readout (BOSS INTEL law). The picker is left open for boss-prep.",
                    true, "Choose Boss Target");
            if (!ok) {
                bossPickerOpen = false;
            }
            return ok;
        });

        stop("boss-prep", TAB_ACTION, true, () -> {
            if (!openBossPicker()) {
                return false;
            }
            // If a route landed directly on a prep surface, capture it —
            // never tap rows on a prep screen, where the widest button
            // may be Fight itself.
            if (vf("Boss Prep") != null && vf("Choose Boss Target") == null) {
                boolean ok = capture("boss-prep",
                        "Boss prep (landed directly via " + bossRoute + "): boss intel only (effects / mechanics / stats) — readiness and win-chance are deliberately never computed (BOSS INTEL law). The crawl does not start the fight.",
                        false, "Boss Prep");
                tapVisible("Change Boss");
                return ok;
            }
            Set<String> deny = new HashSet<>(Arrays.asList(
                    "Choose Boss Target", "Choose Boss", "Switch Action", "Back", "Collect", "Got it",
                    "Fight", "Boss Fight", "Start Fight", "Begin Fight", "Enter Fight"));
            if (!tapFirstRow(deny)) {
                lastFail = "boss picker opened but no tappable boss row was found";
                closeSheet();
                bossPickerOpen = false;
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Boss Prep", "Boss Intel") == null) {
                lastFail = "tapping a boss row did not land on a prep surface ('Boss Prep' section never appeared)";
                bossPickerOpen = false;
                return false;
            }
            boolean ok = capture("boss-prep",
                    "Boss prep: boss intel only (effects / mechanics / stats) — readiness and win-chance are deliberately never computed (BOSS INTEL law). The crawl does not start the fight.",
                    false, "Boss Prep", "Boss Intel");
            bossPickerOpen = false;
            // Leave prep state tidy for later stops; harmless if it fails.
            tapVisible("Leave");
            return ok;
        });

        // ---- GEAR (Inventory) ----
        stop("gear-loadout", TAB_GEAR, () -> {
            if (!tapGearTab("Loadout")) {
                return false;
            }
            return capture("gear-loadout",
                    "Gear tab → Loadout: the 7 gear slots + vehicle slot (the one gear home), with the Garage section below.",
                    false, "Vehicle", "Garage", "Loadout");
        });

        stop("gear-garage", TAB_GEAR, () -> {
            int swipes = scrollSearch(6, "Garage");
            if (swipes < 0) {
                // Maybe standing on a different Gear sub-tab — go via Loadout.
                if (tapGearTab("Loadout")) {
                    swipes = scrollSearch(6, "Garage");
                }
            }
            if (swipes < 0) {
                lastFail = "'Garage' section never entered the viewport on the Loadout tab within 6 scroll swipes";
                return false;
            }
            return capture("gear-garage",
                    "Garage section of the Loadout tab: vehicle, fuel cells, condition, patch kits." + swipeNote(swipes),
                    false, "Garage");
        });

        stop("gear-grid", TAB_GEAR, () -> {
            if (!tapGearTab("Gear")) {
                return false;
            }
            if (capture("gear-grid",
                    "Gear tab → Gear: the item grid with its filter sections (starter bundle gear for a fresh guest).",
                    false, "Rarity", "Weapon Type", "Manufacturer")) {
                return true;
            }
            // Fallback verification: a tappable item card in the body is
            // itself proof the grid rendered (labels are generated).
            Set<String> deny = new HashSet<>(GEAR_TAB_LABELS);
            deny.addAll(Arrays.asList("Back", "Collect", "Got it",
                    "State", "Rarity", "Element", "Weapon Type", "Manufacturer", "Source"));
            if (findFirstRow(deny) != null) {
                snap("gear-grid",
                        "Gear tab → Gear: the item grid. [verified by the presence of tappable item cards in the viewport; the filter-section labels were not in the tree this run]");
                return true;
            }
            lastFail = "gear grid verified neither by filter-section anchors nor by any tappable item card";
            return false;
        });

        stop("gear-inspect", TAB_GEAR, () -> {
            if (!tapGearTab("Gear")) {
                return false;
            }
            Set<String> deny = new HashSet<>(GEAR_TAB_LABELS);
            deny.addAll(Arrays.asList("Back", "Collect", "Got it",
                    "State", "Rarity", "Element", "Weapon Type", "Manufacturer", "Source"));
            if (!tapFirstRow(deny)) {
                lastFail = "no tappable item card found in the gear grid";
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Market Intelligence", "Salvage Forecast", "Stat Poster") == null) {
                lastFail = "gear inspect sheet did not open (its stable sections — Market Intelligence / Salvage Forecast / Stat Poster — never appeared; item names are generated and never used as anchors)";
                closeSheet();
                return false;
            }
            boolean ok = capture("gear-inspect",
                    "Gear inspect sheet: full item card (stats, parts, affixes, Market Intelligence, Salvage Forecast) for the tapped item.",
                    true, "Market Intelligence", "Salvage Forecast", "Stat Poster");
            closeSheet();
            waitGone(4000, "Market Intelligence", "Salvage Forecast");
            return ok;
        });

        stop("gear-items", TAB_GEAR, () -> {
            if (!tapGearTab("Items")) {
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Consumables") == null) {
                lastFail = "Items pane did not render (ConsumablesScreen heading 'Consumables' never appeared)";
                return false;
            }
            return capture("gear-items",
                    "Gear tab → Items: consumables and materials stacks (ConsumablesScreen).",
                    false, "Consumables");
        });

        stop("gear-workshop", TAB_GEAR, () -> {
            if (!tapGearTab("Workshop")) {
                return false;
            }
            // The tab label and the screen title are both "Workshop" —
            // only the title is a large display node in the top region.
            if (vfLarge("Workshop", y(0.025)) == null
                    && waitVisible(NAV_WAIT_MS, "Workshop") == null) {
                lastFail = "Workshop screen never rendered after tapping its Gear tab";
                return false;
            }
            if (vfLarge("Workshop", y(0.025)) == null) {
                lastFail = "only the 'Workshop' tab label was present — the Workshop screen's large title node never verified, so the pane itself is unproven";
                return false;
            }
            return capture("gear-workshop",
                    "Gear tab → Workshop: benches, recipe catalog, and craft queue (crafting's home). [anchor: the large 'Workshop' screen title, distinguished from the same-text tab label by node height]",
                    false, "Workshop");
        });

        // ---- MARKET (post-#254: guests SEE every tab with real data;
        //      only transacting is sign-in locked, at the action) ----
        stop("market-vendor", TAB_MARKET, () -> {
            if (!tapMarketTab("Vendor")) {
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Item of the Day", "Data Slots", "Rotating stock") == null) {
                lastFail = "Vendor pane did not render (none of its content anchors — Item of the Day / Data Slots / rotating stock — appeared)";
                return false;
            }
            return capture("market-vendor",
                    "Market → Vendor: the NPC vendor (open to guests) — staples at flat 100% quality, rotating stock, Item of the Day, and the Data Slots machine.",
                    false, "Item of the Day", "Data Slots", "Rotating stock", "Vendor");
        });

        stop("market-buy", TAB_MARKET, () -> {
            if (!tapMarketTab("Buy")) {
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Search caches", "All") == null) {
                lastFail = "Buy pane did not render for the guest (its search field / category chips never appeared) — since PR #254 guests see the player market with real data";
                return false;
            }
            return capture("market-buy",
                    "Market → Buy: the player market as a guest sees it since PR #254 — real listings, read-only; the sign-in lock lives on the Buy action itself, not the screen.",
                    false, "Search caches", "All");
        });

        stop("market-repair", TAB_MARKET, () -> {
            if (!tapMarketTab("Repair Services")) {
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Open postings", "Post a repair job") == null) {
                lastFail = "Repair Services board did not render for the guest (its 'Open postings' body never appeared; the tab label alone is not proof — the board heading carries the same text)";
                return false;
            }
            return capture("market-repair",
                    "Market → Repair Services: the open-market repair board as a guest sees it since PR #254 — real postings; posting/accepting is sign-in locked at the action.",
                    false, "Open postings", "Post a repair job");
        });

        stop("market-shield-tech", TAB_MARKET, () -> {
            if (!tapMarketTab("Shield Tech")) {
                return false;
            }
            if (waitVisible(NAV_WAIT_MS, "Open postings", "Post a recalibration") == null) {
                lastFail = "Shield Tech board did not render for the guest (its 'Open postings' body never appeared; the tab label alone is not proof — the board heading carries the same text)";
                return false;
            }
            return capture("market-shield-tech",
                    "Market → Shield Tech: the shield recalibration board as a guest sees it since PR #254 — real postings; ordering is sign-in locked at the action.",
                    false, "Open postings", "Post a recalibration");
        });

        // ---- RANK ----
        stop("rank-leaderboards", TAB_RANK, () -> capture("rank-leaderboards",
                "Rank tab: Leaderboards — weekly races with drop-luck rewards, last week's finals, and the player's standings (guest reads are open; the crawl signs nothing).",
                false, "Leaderboards", "Weekly Races"));

        // ---- HUNTER (Profile) ----
        stop("hunter-profile", TAB_HUNTER, () -> capture("hunter-profile",
                "Hunter (Profile) top: Trophy Shelf showcase + lifetime stat cards.",
                false, "Trophy Shelf"));

        stop("hunter-cache-rank", TAB_HUNTER, () -> {
            int swipes = scrollSearch(6, "Cache Rank");
            if (swipes < 0) {
                lastFail = "'Cache Rank' panel never entered the viewport within 6 scroll swipes";
                return false;
            }
            return capture("hunter-cache-rank",
                    "Cache Rank panel: level-earned tokens spent across 7 tracks (no respec)." + swipeNote(swipes),
                    false, "Cache Rank");
        });

        stop("hunter-research", TAB_HUNTER, () -> {
            int swipes = scrollSearch(8, "Research");
            if (swipes < 0) {
                lastFail = "'Research' panel never entered the viewport within 8 scroll swipes";
                return false;
            }
            return capture("hunter-research",
                    "Research panel: the parallel education track (courses run beside the personal action slot — the one deliberate exception to one-action-at-a-time)." + swipeNote(swipes),
                    false, "Research");
        });

        stop("hunter-skill-trees", TAB_HUNTER, () -> {
            int swipes = scrollSearch(10, "Skill Trees");
            if (swipes < 0) {
                lastFail = "embedded 'Skill Trees' never entered the viewport within 10 scroll swipes";
                return false;
            }
            return capture("hunter-skill-trees",
                    "Skill Trees embedded in the Hunter tab: four trees (Gunslinger / Demolition / Scavenger / Fixer), 1 point per level." + swipeNote(swipes),
                    false, "Skill Trees");
        });

        stop("hunter-account-tools", TAB_HUNTER, () -> {
            int swipes = scrollSearch(12, "Account Tools");
            if (swipes < 0) {
                lastFail = "'Account Tools' section never entered the viewport within 12 scroll swipes";
                return false;
            }
            return capture("hunter-account-tools",
                    "Account Tools: Settings, Collections, and account rows at the foot of the Hunter tab." + swipeNote(swipes),
                    false, "Account Tools");
        });

        stop("collections", TAB_HUNTER, () -> {
            int swipes = scrollSearch(12, "Collections");
            if (swipes < 0) {
                lastFail = "'Collections' row never entered the viewport within 12 scroll swipes";
                return false;
            }
            if (!tapVisible("Collections")) {
                lastFail = "'Collections' row found but not tappable";
                return false;
            }
            // Behavioral verification: the Hunter list (Account Tools)
            // must be GONE and a 'Collections' node present — the row and
            // the screen share the same text, so presence alone proves
            // nothing.
            if (!waitGone(8000, "Account Tools") || vf("Collections") == null) {
                lastFail = "tapping 'Collections' did not navigate (the Hunter list is still present or no Collections title appeared)";
                tapBack();
                return false;
            }
            boolean ok = capture("collections",
                    "Collections screen: the trophy-shelf index — effects, bosses, frames, named elites, legendary cores. [verified behaviorally: the Hunter list disappeared and the Collections title is present; row and title share one text]" + swipeNote(swipes),
                    false, "Collections");
            tapBack();
            return ok;
        });

        flushManifest();
        Log.i(TAG, "Screen inventory crawl complete: " + shotSeq + " screenshots.");
    }
}
