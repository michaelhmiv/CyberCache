# Android Play Release

CyberCache ships to Android through Capacitor from the repo-root Vite app.

## Required Accounts And Secrets

- Google Play package: `com.michaelhmiv.cybercache`
- AdMob Android app id: `ADMOB_APP_ID_ANDROID`
- AdMob rewarded ad unit id: `ADMOB_REWARDED_CACHE_KEY_AD_UNIT_ID`
- Firebase Android config JSON: `GOOGLE_SERVICES_JSON`
- Play upload service account: `PLAY_SERVICE_ACCOUNT_JSON`
- Upload signing secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

## Local Build

```bash
npm install
npm run android:sync
```

Open the Android project with:

```bash
npm run android:open
```

## Release Flow

Run the `Play Internal Release` workflow from GitHub Actions. It builds the web app, syncs Capacitor, signs an Android App Bundle, uploads the AAB artifact, and sends it to the Play internal testing track.

The checked-in AdMob app id is Google's sample id so local debug builds do not crash before production credentials exist. The workflow replaces it with `ADMOB_APP_ID_ANDROID`.

Internal tester opt-in link:

```text
https://play.google.com/apps/testing/com.michaelhmiv.cybercache
```

The Play Developer API can upload builds to the internal track, but individual tester email lists are managed in Play Console. Add `michaelhmiv@gmail.com` to the CyberCache internal testing email list there, or configure a Google Group for the internal track. After the tester opens the opt-in link once, new internal builds uploaded by GitHub Actions should arrive through the Play Store update flow.

Version-code bands follow the existing Play release convention:

- Internal testing: `200000 + GITHUB_RUN_NUMBER`
- Closed testing: `400000 + GITHUB_RUN_NUMBER`
- Production: `600000 + GITHUB_RUN_NUMBER`

## Current GitHub Secret State

GitHub environments are configured for release-track-specific config:

- `CyberCache / internal`
- `CyberCache / closed-testing`
- `CyberCache / production`

The release workflows are bound to those environments. Repository-level secrets are still available to each workflow, and environment-level secrets can override or supplement them when CyberCache gets app-specific AdMob/Firebase values.

The CyberCache repo has these reusable Play/signing secrets configured:

- `PLAY_SERVICE_ACCOUNT_JSON`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The local CyberCache upload keystore is preserved outside Git at `.local-secrets/cybercache-upload-keystore.jks`.

Upload key fingerprints:

- SHA1: `12:12:4F:DD:B8:5A:4D:9D:68:6B:09:58:05:1B:CB:9E:6C:0B:37:5B`
- SHA256: `91:46:88:51:19:3D:49:8D:2E:C2:63:44:6F:D0:C1:22:30:66:40:51:72:CE:4F:60:20:9D:EB:F7:EA:CC:5D:E5`

These app-specific secrets are intentionally not copied from Sportfolio:

- `ADMOB_APP_ID_ANDROID`
- `ADMOB_REWARDED_CACHE_KEY_AD_UNIT_ID`
- `GOOGLE_SERVICES_JSON`

Use `.env.example` for local web/native development variables and `.env.android.example` as the template for release signing, Play upload, AdMob, and Firebase configuration.

## Runtime Behavior

- The only rewarded-ad entry point is the small plus button in the top cache-key chip.
- The client shows a rewarded ad, then calls `cc_claim_rewarded_cache_key`.
- Supabase increments `profiles.cache_tokens` server-side, with daily cap, cooldown, and idempotency.
- Push notification registration only runs in native builds and stores FCM tokens through `cc_register_push_device`.
