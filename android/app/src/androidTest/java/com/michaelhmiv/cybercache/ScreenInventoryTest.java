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
import androidx.test.uiautomator.Until;

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
 * Launches the real app, enters as a guest, dismisses first-run surfaces,
 * then walks every reachable screen, saving a screenshot + window-hierarchy
 * dump per stop and a manifest.json describing what was reached.
 *
 * Design contract:
 *  - Tolerant by design: a deep screen that cannot be reached is recorded
 *    in the manifest as missed with a reason; it does NOT fail the test.
 *  - The test fails only when the app does not launch, the guest entry
 *    never renders, or the guest Board (home) never renders.
 *  - Navigation is by visible text / content-description via UiAutomator.
 *    The app is a Capacitor WebView; DOM text and aria-labels surface in
 *    the accessibility tree as node text / content-desc.
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

    /** Bottom-nav labels (src/constants/navSigils.ts) — also row deny-list. */
    private static final Set<String> TAB_LABELS = new HashSet<>(Arrays.asList(
            "Board", "Action", "Gear", "Market", "Rank", "Hunter"));

    private UiDevice device;
    private File outDir;
    private boolean internalStorageFallback = false;
    private int displayWidth;
    private int displayHeight;
    private int shotSeq = 0;
    private final List<String> manifestEntries = new ArrayList<>();

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

    /** Find by visible text first (exact, then contains), then content-desc. */
    private UiObject2 find(String needle, boolean exact) {
        UiObject2 o = exact ? device.findObject(By.text(needle)) : device.findObject(By.textContains(needle));
        if (o != null) {
            return o;
        }
        return exact ? device.findObject(By.desc(needle)) : device.findObject(By.descContains(needle));
    }

    /** Poll until any needle is visible; returns the matched needle or null. */
    private String waitForAny(long timeoutMs, String... needles) {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            for (String n : needles) {
                if (find(n, false) != null) {
                    return n;
                }
            }
            SystemClock.sleep(600);
        }
        return null;
    }

    /** Tap the first candidate that exists. Returns the tapped label or null. */
    private String tap(String... candidates) {
        for (String c : candidates) {
            UiObject2 o = find(c, true);
            if (o == null) {
                o = find(c, false);
            }
            if (o != null) {
                o.click();
                settle();
                return c;
            }
        }
        return null;
    }

    /** Tap a bottom-nav tab: pick the bottom-most object with the label. */
    private boolean tapTab(String label) {
        ensureForeground();
        List<UiObject2> objs = device.findObjects(By.text(label));
        if (objs == null || objs.isEmpty()) {
            objs = device.findObjects(By.desc(label));
        }
        UiObject2 best = null;
        int bestY = -1;
        if (objs != null) {
            for (UiObject2 o : objs) {
                try {
                    Rect b = o.getVisibleBounds();
                    if (b != null && b.centerY() > bestY) {
                        bestY = b.centerY();
                        best = o;
                    }
                } catch (Exception ignored) {
                    // Stale node — skip.
                }
            }
        }
        if (best != null && bestY > displayHeight * 0.65) {
            best.click();
            settleLong();
            return true;
        }
        return tap(label) != null;
    }

    private void scrollDown() {
        device.swipe(displayWidth / 2, (int) (displayHeight * 0.72),
                displayWidth / 2, (int) (displayHeight * 0.34), 22);
        SystemClock.sleep(700);
    }

    private void scrollUpToTop() {
        for (int i = 0; i < 5; i++) {
            device.swipe(displayWidth / 2, (int) (displayHeight * 0.30),
                    displayWidth / 2, (int) (displayHeight * 0.78), 22);
            SystemClock.sleep(400);
        }
    }

    /** Scroll the page until the needle is visible (or give up). */
    private boolean scrollTo(String needle, int maxScrolls) {
        if (find(needle, false) != null) {
            return true;
        }
        for (int i = 0; i < maxScrolls; i++) {
            scrollDown();
            if (find(needle, false) != null) {
                return true;
            }
        }
        return false;
    }

    /** Tap the sub-screen "← Back" header button (top region only). */
    private boolean tapBack() {
        List<UiObject2> objs = device.findObjects(By.textContains("Back"));
        UiObject2 best = null;
        int bestY = Integer.MAX_VALUE;
        if (objs != null) {
            for (UiObject2 o : objs) {
                try {
                    Rect b = o.getVisibleBounds();
                    if (b != null && b.centerY() < displayHeight * 0.25 && b.centerY() < bestY) {
                        bestY = b.centerY();
                        best = o;
                    }
                } catch (Exception ignored) {
                    // Stale node — skip.
                }
            }
        }
        if (best != null) {
            best.click();
            settle();
            return true;
        }
        return false;
    }

    /** Dismiss a bottom sheet by tapping the scrim near the top. */
    private void closeSheet() {
        device.click(displayWidth / 2, (int) (displayHeight * 0.10));
        settle();
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
     * Tap the first plausible list row: a wide, clickable, text-bearing
     * object in the middle band of the screen that is not chrome (bottom
     * nav, back buttons) and not in the caller's deny-list. Used for the
     * boss picker rows and the first gear-grid item, whose labels are
     * generated content the crawl cannot know in advance.
     */
    private boolean tapFirstRow(Set<String> deny) {
        List<UiObject2> objs = device.findObjects(By.clickable(true));
        if (objs == null || objs.isEmpty()) {
            objs = device.findObjects(By.clazz("android.widget.Button"));
        }
        if (objs == null) {
            return false;
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
                if (deny.contains(text) || TAB_LABELS.contains(text)) {
                    continue;
                }
                int cy = b.centerY();
                if (cy < displayHeight * 0.14 || cy > displayHeight * 0.90) {
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
        if (best != null) {
            best.click();
            settleLong();
            return true;
        }
        return false;
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

    /** Settle, screenshot, dump hierarchy, record a reached stop. */
    private void snap(String screen, String note) {
        settle();
        shotSeq++;
        String base = String.format(Locale.US, "%02d-%s", shotSeq, screen);
        File png = new File(outDir, base + ".png");
        File xml = new File(outDir, base + ".xml");
        boolean shot = false;
        try {
            shot = device.takeScreenshot(png);
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
        record(base + ".png", screen, true,
                note + (shot ? "" : " (WARNING: takeScreenshot returned false)")
                        + (internalStorageFallback ? " (internal-storage fallback dir)" : ""));
    }

    private void miss(String screen, String reason) {
        record("", screen, false, reason);
    }

    /** Run one crawl stop; any failure becomes a manifest miss, never a crash. */
    private void stop(String screen, StopBody body) {
        try {
            ensureForeground();
            body.run();
        } catch (Throwable t) {
            Log.e(TAG, "Stop failed: " + screen, t);
            miss(screen, "Exception during crawl stop: " + t.getClass().getSimpleName()
                    + ": " + String.valueOf(t.getMessage()));
        }
    }

    private interface StopBody {
        void run() throws Exception;
    }

    // ------------------------------------------------------------------
    // First run
    // ------------------------------------------------------------------

    /**
     * Dismiss first-run surfaces until the Board is unobstructed: the
     * starter bundle reveal ("Loot Secured" → "Collect") and, if one is
     * pending, an offline recap ("Got it"). Both are overlays above the
     * Dashboard; the crawl wants the real home underneath.
     */
    private void dismissFirstRunSurfaces() {
        long deadline = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < deadline) {
            if (tap("Collect") != null) {
                continue;
            }
            if (tap("Got it") != null) {
                continue;
            }
            UiObject2 dismiss = device.findObject(By.desc("Dismiss"));
            if (dismiss != null) {
                dismiss.click();
                settle();
                continue;
            }
            if (find("Level Progress", true) != null || find("Login Streak", true) != null) {
                return;
            }
            SystemClock.sleep(800);
        }
    }

    // ------------------------------------------------------------------
    // The crawl
    // ------------------------------------------------------------------

    @Test
    public void crawlAllScreens() {
        // ---- Launch + guest entry (the only hard-failure section) ----
        launchApp();
        boolean authSeen = device.wait(Until.hasObject(By.textContains("Continue as Guest")), 45000);
        if (!authSeen) {
            // A returning session skips auth entirely — that is fine too.
            if (waitForAny(5000, "Level Progress", "Login Streak") == null) {
                record("", "auth", false, "Neither the auth screen nor a live session rendered after launch.");
                flushManifest();
                assertTrue("App did not reach the auth screen or a live session after launch", false);
            }
        } else {
            snap("auth", "Auth screen as launched: Sign in with Google + Continue as Guest (the only two entries by design).");
            String tapped = tap("Continue as Guest");
            assertTrue("Guest entry button was visible but could not be tapped", tapped != null);
            settleLong();
        }
        dismissFirstRunSurfaces();
        boolean home = waitForAny(20000, "Level Progress", "Login Streak", "Contracts") != null;
        if (!home) {
            record("", "board-home", false, "Guest Board never rendered after guest entry + first-run dismissal.");
            flushManifest();
            assertTrue("Guest home (Board) never rendered", false);
        }
        snap("board-home", "Board (Dashboard) top: resource bar, current-area chip, level strip with XP progress bar.");

        // ---- BOARD deep stops ----
        stop("board-area-picker", () -> {
            // CurrentAreaChip carries aria-label "Change area" on the Board.
            UiObject2 chip = device.findObject(By.desc("Change area"));
            if (chip == null) {
                miss("board-area-picker", "Current-area chip (content-desc 'Change area') not found on the Board.");
                return;
            }
            chip.click();
            settleLong();
            if (waitForAny(6000, "Choose Area", "Dustwaste") == null) {
                miss("board-area-picker", "Area picker did not open from the current-area chip.");
                closeSheet();
                return;
            }
            snap("board-area-picker", "Area picker opened from the Board's current-area chip: the 7 roaming areas with unlock levels.");
            closeSheet();
        });

        stop("board-panels", () -> {
            scrollUpToTop();
            scrollDown();
            if (find("Login Streak", false) == null && find("Contracts", false) == null) {
                scrollDown();
            }
            snap("board-panels", "Board scrolled: daily Login Streak panel and Contracts panel (current master renders them in the scroll; icon/pop-up redesign in flight).");
        });

        stop("settings", () -> {
            if (!scrollTo("Settings", 4)) {
                miss("settings", "'Settings' quick action not found on the Board.");
                return;
            }
            if (tap("Settings") == null) {
                miss("settings", "'Settings' quick action visible but not tappable.");
                return;
            }
            if (waitForAny(6000, "Options Board", "Preferences") == null) {
                miss("settings", "Settings sub-screen did not render after tapping the quick action.");
                tapBack();
                return;
            }
            snap("settings", "Settings sub-screen (header 'Options Board') from the Board quick action — same destination as Hunter → Account Tools.");
            tapBack();
        });

        stop("crack-cache", () -> {
            scrollUpToTop();
            if (!scrollTo("Crack Cache", 4)) {
                miss("crack-cache", "'Crack Cache' quick action not found on the Board.");
                return;
            }
            if (tap("Crack Cache") == null) {
                miss("crack-cache", "'Crack Cache' quick action visible but not tappable.");
                return;
            }
            settleLong();
            snap("crack-cache", "Cache lane (ChestScreen): the daily cache-box budget — 1 free box, then key/ad openings. Reached from the Board; the Rank tab's cache entry leads here too.");
            tapBack();
        });

        stop("dispatch", () -> {
            scrollUpToTop();
            if (!scrollTo("Dispatch", 4)) {
                miss("dispatch", "'Dispatch' quick action not found on the Board.");
                return;
            }
            if (tap("Dispatch") == null) {
                miss("dispatch", "'Dispatch' quick action visible but not tappable.");
                return;
            }
            settleLong();
            snap("dispatch", "Dispatch board: timed contracts (incl. courier tiers) for spare loadouts and vehicles.");
            tapBack();
        });

        // ---- ACTION ----
        stop("action-main", () -> {
            if (!tapTab("Action")) {
                miss("action-main", "Action tab could not be tapped.");
                return;
            }
            settleLong();
            snap("action-main", "Action tab as a fresh guest finds it: standby state, action stage, vehicle line, loadout strip, feed.");
        });

        stop("action-roaming", () -> {
            String t = tap("Start Roam", "Start Roaming", "Begin Roam", "Roam");
            if (t == null) {
                miss("action-roaming", "No roaming start button found on the Action stage (tried Start Roam / Start Roaming / Begin Roam / Roam).");
                return;
            }
            settleLong();
            snap("action-roaming", "Roaming live: the tick loop running in the starter area (Dustwaste Frontier) with the live feed.");
        });

        stop("action-switcher", () -> {
            if (tap("Switch Action") == null) {
                miss("action-switcher", "'Switch Action' affordance not found on the Action tab.");
                return;
            }
            if (waitForAny(5000, "Choose what", "Roaming Loot", "Extraction") == null) {
                miss("action-switcher", "Switch Action sheet did not open.");
                closeSheet();
                return;
            }
            snap("action-switcher", "Switch Action sheet: the one-action-at-a-time list (roam / boss / craft / extract / salvage / endless).");
        });

        stop("action-extraction", () -> {
            if (find("Switch Action", true) == null && tap("Switch Action") == null) {
                miss("action-extraction", "Could not open the Switch Action sheet to reach Extraction.");
                return;
            }
            settle();
            if (tap("Extraction") == null) {
                miss("action-extraction", "'Extraction' row not found in the Switch Action sheet.");
                closeSheet();
                return;
            }
            settleLong();
            snap("action-extraction", "Extraction panel: 10-minute dig-site passes (Surface / Deep Delve), the extraction occupation surface.");
        });

        stop("action-crafting", () -> {
            if (tap("Switch Action") == null) {
                miss("action-crafting", "Could not reopen the Switch Action sheet to reach Crafting.");
                return;
            }
            settle();
            if (tap("Crafting") == null) {
                miss("action-crafting", "'Crafting' row not found in the Switch Action sheet.");
                closeSheet();
                return;
            }
            settleLong();
            snap("action-crafting", "Crafting panel on the Action tab: bench jobs + Recipe Control ('Open Workshop' leads to the full Workshop).");
        });

        // ---- Boss select + prep (two routes; record the one that worked) ----
        final boolean[] bossDone = {false};
        stop("boss-select", () -> {
            // Route A: the Switch Action sheet's boss row opens the picker.
            if (tap("Switch Action") != null) {
                settle();
                if (tap("Boss Encounter", "Boss") != null) {
                    settleLong();
                    if (waitForAny(5000, "Choose Boss Target", "Dune Tyrant", "Boss Intel") != null) {
                        snap("boss-select", "Boss target picker ('Choose Boss Target' sheet) via the Action switcher. Rows are intel-only by design — no win-chance readout.");
                        bossDone[0] = true;
                        return;
                    }
                }
                closeSheet();
            }
            // Route B: the Board diorama's "Choose Boss" opens BossSelectModal.
            if (tapTab("Board")) {
                scrollUpToTop();
                if (scrollTo("Choose Boss", 4) && tap("Choose Boss", "Prep Boss") != null) {
                    settleLong();
                    snap("boss-select", "BossSelectModal via the Board diorama's 'Choose Boss'. Rows are intel-only by design — no win-chance readout.");
                    bossDone[0] = true;
                    return;
                }
            }
            miss("boss-select", "Neither the Action switcher boss row nor the Board diorama 'Choose Boss' opened a boss picker.");
        });

        stop("boss-prep", () -> {
            if (!bossDone[0]) {
                miss("boss-prep", "Boss picker never opened (see boss-select), so prep could not be reached.");
                return;
            }
            // Already standing on prep (e.g. the Board route's "Prep Boss"
            // navigated straight here)? Capture it — never tap rows on a
            // prep screen, where the widest button may be Fight itself.
            if (waitForAny(3000, "Boss Prep") != null) {
                snap("boss-prep", "Boss prep: boss intel only (effects / mechanics / stats) — readiness and win-chance are deliberately never computed (BOSS INTEL law). The crawl does not start the fight.");
                tap("Leave", "Abandon", "Retreat", "Change Boss");
                return;
            }
            Set<String> deny = new HashSet<>(Arrays.asList(
                    "Choose Boss Target", "Choose Boss", "Switch Action", "Back", "Collect", "Got it",
                    "Fight", "Start Fight", "Begin Fight", "Enter Fight"));
            if (!tapFirstRow(deny)) {
                miss("boss-prep", "Boss picker opened but no tappable boss row was found.");
                closeSheet();
                return;
            }
            settleLong();
            if (waitForAny(6000, "Boss Prep", "Boss Encounter", "Fight") == null) {
                miss("boss-prep", "Tapping a boss row did not land on a prep/encounter surface.");
                return;
            }
            snap("boss-prep", "Boss prep: boss intel only (effects / mechanics / stats) — readiness and win-chance are deliberately never computed (BOSS INTEL law). The crawl does not start the fight.");
            // Leave prep state tidy for later stops; harmless if it fails.
            tap("Leave", "Abandon", "Retreat", "Change Boss");
        });

        // ---- GEAR (Inventory) ----
        stop("gear-loadout", () -> {
            if (!tapTab("Gear")) {
                miss("gear-loadout", "Gear tab could not be tapped.");
                return;
            }
            settleLong();
            tapTopmost("Loadout");
            settleLong();
            snap("gear-loadout", "Gear tab → Loadout: the 7 gear slots + vehicle slot (the one gear home).");
        });

        stop("gear-garage", () -> {
            if (!scrollTo("Garage", 5)) {
                miss("gear-garage", "'Garage' section not found below the loadout slots.");
                return;
            }
            scrollDown();
            snap("gear-garage", "Garage section of the Loadout tab: vehicle, fuel cells, condition, patch kits.");
        });

        stop("gear-grid", () -> {
            scrollUpToTop();
            tapTopmost("Gear");
            settleLong();
            snap("gear-grid", "Gear tab → Gear: the item grid (starter bundle gear for a fresh guest).");
        });

        stop("gear-inspect", () -> {
            Set<String> deny = new HashSet<>(Arrays.asList(
                    "Gear", "Loadout", "Items", "Workshop", "Back", "Collect", "Got it"));
            if (!tapFirstRow(deny)) {
                miss("gear-inspect", "No tappable item card found in the gear grid.");
                return;
            }
            settleLong();
            snap("gear-inspect", "Gear inspect sheet: full item card (stats, parts, affixes, market intel, salvage forecast) for the tapped item.");
            closeSheet();
        });

        stop("gear-items", () -> {
            scrollUpToTop();
            if (!tapTopmost("Items")) {
                miss("gear-items", "'Items' tab not found on the Gear screen.");
                return;
            }
            settleLong();
            snap("gear-items", "Gear tab → Items: consumables and materials stacks.");
        });

        stop("gear-workshop", () -> {
            scrollUpToTop();
            if (!tapTopmost("Workshop")) {
                miss("gear-workshop", "'Workshop' tab not found on the Gear screen.");
                return;
            }
            settleLong();
            snap("gear-workshop", "Gear tab → Workshop: benches, recipe catalog, and craft queue (crafting's home).");
        });

        // ---- MARKET (guest: everything but the vendor is locked) ----
        stop("market-vendor", () -> {
            if (!tapTab("Market")) {
                miss("market-vendor", "Market tab could not be tapped.");
                return;
            }
            settleLong();
            tap("Vendor");
            settleLong();
            snap("market-vendor", "Market → Vendor: the NPC vendor (open to guests) — staples at flat 100% quality, daily rotation, Item of the Day.");
        });

        stop("market-buy", () -> {
            revealMarketTab("Buy");
            String t = tap("Buy");
            settleLong();
            if (t == null) {
                miss("market-buy", "'Buy' tab not present on the Market screen.");
                return;
            }
            // Guests are locked out of the player market in the shipped UI:
            // capture the state, but report the screen itself as unreached.
            record(marketStateShot("market-buy"),
                    "market-buy", false,
                    "Player market (Buy) is locked for guest sessions in the shipped UI — tabs carry 'locked — sign in to use the player market'. Screenshot shows the guest state after tapping Buy.");
        });

        stop("market-repair", () -> {
            revealMarketTab("Repair Services");
            String t = tap("Repair Services");
            settleLong();
            if (t == null) {
                miss("market-repair", "'Repair Services' tab not present on the Market screen.");
                return;
            }
            record(marketStateShot("market-repair"),
                    "market-repair", false,
                    "Repair Services board sits behind the same guest lock as the player market in the shipped UI. Screenshot shows the guest state after tapping the tab.");
        });

        stop("market-shield-tech", () -> {
            revealMarketTab("Shield Tech");
            String t = tap("Shield Tech");
            settleLong();
            if (t == null) {
                miss("market-shield-tech", "'Shield Tech' tab not present on the Market screen.");
                return;
            }
            record(marketStateShot("market-shield-tech"),
                    "market-shield-tech", false,
                    "Shield Tech board sits behind the same guest lock as the player market in the shipped UI. Screenshot shows the guest state after tapping the tab.");
        });

        // ---- RANK ----
        stop("rank-leaderboards", () -> {
            if (!tapTab("Rank")) {
                miss("rank-leaderboards", "Rank tab could not be tapped.");
                return;
            }
            settleLong();
            snap("rank-leaderboards", "Rank tab: weekly leaderboards (8 races, drop-luck rewards). Cache lane lives on the Board's Crack Cache; Cache Rank lives on the Hunter tab — both captured at their homes.");
        });

        stop("rank-scrolled", () -> {
            scrollDown();
            snap("rank-scrolled", "Rank tab scrolled: the week's race list and standings.");
        });

        // ---- HUNTER (Profile) ----
        stop("hunter-profile", () -> {
            if (!tapTab("Hunter")) {
                miss("hunter-profile", "Hunter tab could not be tapped.");
                return;
            }
            settleLong();
            scrollUpToTop();
            snap("hunter-profile", "Hunter (Profile) top: Trophy Shelf showcase + lifetime stat cards.");
        });

        stop("hunter-cache-rank", () -> {
            if (!scrollTo("Cache Rank", 6)) {
                miss("hunter-cache-rank", "'Cache Rank' panel not found on the Hunter tab.");
                return;
            }
            scrollDown();
            snap("hunter-cache-rank", "Cache Rank panel: level-earned tokens spent across 7 tracks (no respec).");
        });

        stop("hunter-research", () -> {
            scrollUpToTop();
            if (!scrollTo("Research", 8)) {
                miss("hunter-research", "Research panel not found on the Hunter tab.");
                return;
            }
            scrollDown();
            snap("hunter-research", "Research panel: the parallel education track (courses run beside the personal action slot — the one deliberate exception to one-action-at-a-time).");
        });

        stop("hunter-skill-trees", () -> {
            scrollUpToTop();
            if (!scrollTo("Skill Trees", 12)) {
                miss("hunter-skill-trees", "Embedded Skill Trees not found on the Hunter tab.");
                return;
            }
            scrollDown();
            snap("hunter-skill-trees", "Skill Trees embedded in the Hunter tab: four trees (Gunslinger / Demolition / Scavenger / Fixer), 1 point per level.");
        });

        stop("hunter-account-tools", () -> {
            scrollUpToTop();
            if (!scrollTo("Account Tools", 14)) {
                miss("hunter-account-tools", "'Account Tools' section not found on the Hunter tab.");
                return;
            }
            snap("hunter-account-tools", "Account Tools: Settings, Collections, and account rows at the foot of the Hunter tab.");
        });

        stop("collections", () -> {
            if (!scrollTo("Collections", 4) && find("Collections", false) == null) {
                miss("collections", "'Collections' row not found near Account Tools.");
                return;
            }
            if (tap("Collections") == null) {
                miss("collections", "'Collections' row visible but not tappable.");
                return;
            }
            settleLong();
            snap("collections", "Collections sub-screen: the trophy shelf index — effects, bosses, frames, named elites, legendary cores.");
            tapBack();
        });

        flushManifest();
        Log.i(TAG, "Screen inventory crawl complete: " + shotSeq + " screenshots.");
    }

    // ------------------------------------------------------------------
    // Crawl-specific helpers
    // ------------------------------------------------------------------

    /** Tap the topmost object with this exact label (in-screen tab rows). */
    private boolean tapTopmost(String label) {
        List<UiObject2> objs = device.findObjects(By.text(label));
        if (objs == null || objs.isEmpty()) {
            return tap(label) != null;
        }
        UiObject2 best = null;
        int bestY = Integer.MAX_VALUE;
        for (UiObject2 o : objs) {
            try {
                Rect b = o.getVisibleBounds();
                if (b != null && b.centerY() < bestY && b.centerY() < displayHeight * 0.92) {
                    bestY = b.centerY();
                    best = o;
                }
            } catch (Exception ignored) {
                // Stale node — skip.
            }
        }
        if (best != null) {
            best.click();
            settle();
            return true;
        }
        return false;
    }

    /** The Market tab row can overflow horizontally — swipe it to reveal a tab. */
    private void revealMarketTab(String label) {
        if (find(label, false) != null) {
            return;
        }
        UiObject2 vendor = find("Vendor", true);
        int y = vendor != null ? vendor.getVisibleBounds().centerY() : (int) (displayHeight * 0.16);
        for (int i = 0; i < 3 && find(label, false) == null; i++) {
            device.swipe((int) (displayWidth * 0.85), y, (int) (displayWidth * 0.25), y, 16);
            SystemClock.sleep(600);
        }
    }

    /**
     * Screenshot the current Market state for a guest-locked tab stop.
     * Returns the PNG file name so the manifest entry can point at it
     * while still reporting the underlying screen as unreached.
     */
    private String marketStateShot(String screen) {
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
}
