/**
 * BACKUP EXCLUSION for the session store (audit A-09).
 *
 * The session record — access token + rotating refresh token as one
 * JSON value — persists through Capacitor Preferences
 * (`src/lib/api/session.ts`, SESSION_STORAGE_KEY), which on Android
 * is the SharedPreferences file "CapacitorStorage.xml" (the plugin's
 * default group; this app does not override it). Refresh tokens are
 * single-use rotating: presenting a rotated-out token revokes ALL of
 * the account's sessions (the A-05 reuse branch). With
 * `android:allowBackup="true"` and no exclusion rules, that file
 * rode every cloud backup and device transfer — a restored backup
 * either silently WAS the account on a second device, or, once the
 * main device had rotated past it, its first refresh read as token
 * theft and revoked the player's sessions everywhere.
 *
 * The audit's CI assertion: "A repo lint/test asserting the manifest
 * either sets `allowBackup="false"` or references backup rules whose
 * exclusions cover the app's SharedPreferences/Preferences domain.
 * Fails today (neither exists)."
 *
 * This is that test. The posture shipped: backups stay ON for the
 * app, and the credential file is excluded in both rule formats —
 * dataExtractionRules (API 31+: cloud-backup AND device-transfer)
 * and fullBackupContent (legacy, minSdk 24) — each excluding the
 * sharedpref domain's CapacitorStorage.xml.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const PREFS_FILE = 'CapacitorStorage.xml';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** True when an XML fragment carries a sharedpref exclude covering the Preferences file. */
function excludesPreferencesFile(fragment: string): boolean {
  for (const tag of fragment.matchAll(/<exclude\b[^>]*>/g)) {
    const text = tag[0];
    if (!/domain="sharedpref"/.test(text)) continue;
    const path = /path="([^"]*)"/.exec(text)?.[1];
    if (path === undefined || path === PREFS_FILE) return true;
  }
  return false;
}

function section(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m?.[1] ?? '';
}

function rulesRef(manifest: string, attr: string): string | null {
  const m = new RegExp(`${attr}="@xml/([A-Za-z0-9_]+)"`).exec(manifest);
  return m?.[1] ?? null;
}

describe('Android backup exclusion — the session store never backs up (audit A-09)', () => {
  it('the premise holds: the session persists via Capacitor Preferences', () => {
    const session = read(join(ROOT, 'src/lib/api/session.ts'));
    expect(session).toContain("from '@capacitor/preferences'");
    expect(session).toContain('SESSION_STORAGE_KEY');
  });

  it('the manifest excludes the Preferences file from backups, or disables backup outright', () => {
    const manifest = read(MANIFEST);
    if (/android:allowBackup="false"/.test(manifest)) return; // the audit's other accepted posture

    expect(manifest).toContain('android:allowBackup="true"');
    const extractionName = rulesRef(manifest, 'android:dataExtractionRules');
    const legacyName = rulesRef(manifest, 'android:fullBackupContent');
    expect(extractionName, 'manifest must reference dataExtractionRules').not.toBeNull();
    expect(legacyName, 'manifest must reference fullBackupContent (minSdk 24)').not.toBeNull();

    const extractionPath = join(ROOT, 'android/app/src/main/res/xml', `${extractionName}.xml`);
    const legacyPath = join(ROOT, 'android/app/src/main/res/xml', `${legacyName}.xml`);
    expect(existsSync(extractionPath), `${extractionPath} must exist`).toBe(true);
    expect(existsSync(legacyPath), `${legacyPath} must exist`).toBe(true);

    const extraction = read(extractionPath);
    expect(
      excludesPreferencesFile(section(extraction, 'cloud-backup')),
      'dataExtractionRules cloud-backup must exclude the Preferences file',
    ).toBe(true);
    expect(
      excludesPreferencesFile(section(extraction, 'device-transfer')),
      'dataExtractionRules device-transfer must exclude the Preferences file',
    ).toBe(true);

    const legacy = read(legacyPath);
    expect(
      excludesPreferencesFile(section(legacy, 'full-backup-content')),
      'fullBackupContent must exclude the Preferences file',
    ).toBe(true);
  });
});
