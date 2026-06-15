import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const googleProviderPath = resolve(
  repoRoot,
  'node_modules/@capgo/capacitor-social-login/android/src/main/java/ee/forgr/capacitor/social/login/GoogleProvider.java',
);

if (!existsSync(googleProviderPath)) {
  console.warn('[patch-capgo-social-login] GoogleProvider.java not found; skipping Capgo native diagnostics patch.');
  process.exit(0);
}

const source = readFileSync(googleProviderPath, 'utf8');
const marker = 'CyberCache native diagnostic patch';

if (source.includes(marker)) {
  console.log('[patch-capgo-social-login] Capgo native diagnostics patch already applied.');
  process.exit(0);
}

const oldSnippet = `        if (e instanceof GetCredentialCancellationException) {
            call.reject("Google Sign-In cancelled by user", USER_CANCELLED_CODE, e);
            return;
        }
`;

const newSnippet = `        if (e instanceof GetCredentialCancellationException) {
            // CyberCache native diagnostic patch: Capgo collapses Android Credential Manager
            // cancellations into USER_CANCELLED. Preserve native exception metadata in the
            // JS-visible message so Firebase diagnostic builds can distinguish true user
            // dismissal from Google/Play Services/OAuth runtime cancellations.
            String diagnosticMessage = String.format(
                "Google Sign-In cancelled by user [nativeClass=%s, nativeType=%s, nativeMessage=%s, nativeCause=%s]",
                e.getClass().getName(),
                e.getType(),
                e.getMessage(),
                e.getCause() == null ? "null" : e.getCause().getClass().getName() + ": " + e.getCause().getMessage()
            );
            call.reject(diagnosticMessage, USER_CANCELLED_CODE, e);
            return;
        }
`;

if (!source.includes(oldSnippet)) {
  console.warn('[patch-capgo-social-login] Target snippet not found; Capgo source may have changed.');
  process.exit(0);
}

writeFileSync(googleProviderPath, source.replace(oldSnippet, newSnippet));
console.log('[patch-capgo-social-login] Applied Capgo native diagnostics patch.');
