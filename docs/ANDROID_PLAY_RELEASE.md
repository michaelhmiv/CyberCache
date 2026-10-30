# Android Play Release

CyberCache ships to Android through Capacitor from the repo-root Vite app.

## Required Accounts And Secrets

- Google Play package: `com.michaelhmiv.cybercache`
- Google OAuth web client id used by the Chef and native Android sign-in: `VITE_GOOGLE_WEB_CLIENT_ID`
- AdMob Android app id: `ADMOB_APP_ID_ANDROID`
- AdMob rewarded ad unit id: `ADMOB_REWARDED_CACHE_KEY_AD_UNIT_ID`
- Firebase Android config JSON: `GOOGLE_SERVICES_JSON`
- Firebase App Distribution Android app id: `FIREBASE_APP_ID`
- Firebase service account JSON for App Distribution upload: `FIREBASE_SERVICE_ACCOUNT`
- Optional Firebase tester emails: `FIREBASE_DISTRIBUTION_TESTERS`
- Optional Firebase tester group aliases: `FIREBASE_DISTRIBUTION_GROUPS`
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

## Release Flows

### Firebase App Distribution

Run the `Firebase App Distribution` workflow from GitHub Actions when you want a fast installable APK sent directly to test devices. This is the quick tester-download lane.

The workflow builds the Vite app, syncs Capacitor Android, signs a release APK, uploads the APK artifact to GitHub Actions, and distributes the APK through Firebase App Distribution. It always includes `michaelhmiv@gmail.com` as a tester.

Required GitHub secrets:

- `FIREBASE_APP_ID`: CyberCache Firebase Android app id, for example `1:662321788886:android:87a5c0b279c0737c009677`
- `FIREBASE_SERVICE_ACCOUNT`: Firebase service account JSON with permission to upload App Distribution releases
- `GOOGLE_SERVICES_JSON`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `VITE_GOOGLE_WEB_CLIENT_ID`: Google Web OAuth client id the Chef verifies against. Android native Google Sign-In uses this client id to request an ID token, then the Chef verifies it (JWKS) and issues its own session JWTs.

Optional GitHub secrets:

- `FIREBASE_DISTRIBUTION_TESTERS`: comma-separated tester emails
- `FIREBASE_DISTRIBUTION_GROUPS`: comma-separated Firebase App Distribution group aliases

### Play Internal Testing

Run the `Play Internal Release` workflow from GitHub Actions. It builds the web app, syncs Capacitor, signs an Android App Bundle, uploads the AAB artifact, and sends it to the Play internal testing track.

The checked-in AdMob app id is Google's sample id so local debug builds do not crash before production credentials exist. The workflow replaces it with `ADMOB_APP_ID_ANDROID`.

Internal tester opt-in link:

```text
https://play.google.com/apps/testing/com.michaelhmiv.cybercache
```

The Play Developer API can upload builds to the internal track, but individual tester email lists are managed in Play Console. Add `michaelhmiv@gmail.com` to the CyberCache internal testing email list there, or configure a Google Group for the internal track. After the tester opens the opt-in link once, new internal builds uploaded by GitHub Actions should arrive through the Play Store update flow.

### Play Closed Testing

Run the `Play Closed Testing` workflow from GitHub Actions when you want a build on the Play Console closed testing track. This is the lane to use for Play's closed-testing requirement.

The workflow defaults to the `alpha` track, which is the closed-testing track currently shown in Play Console for this app. If you create a custom closed track in Play Console, pass that exact track name through the workflow's `closed_track` input.

The workflow defaults `release_status` to `draft` while CyberCache is still an unreviewed Play app. After Play accepts the app setup and closed testing track, use `release_status=completed` for direct rollout uploads.

Closed testing still requires Play Console setup outside GitHub Actions:

- Create or select the closed testing track.
- Add the required tester email list or Google Group.
- Set countries/regions for the track.
- Copy the closed-track opt-in link from Play Console and send it to testers.
- Testers must opt in and keep the app installed/available for the required testing window.

Version-code bands follow the existing Play release convention:

- Internal testing: `200000 + GITHUB_RUN_NUMBER`
- Firebase App Distribution: `300000 + GITHUB_RUN_NUMBER`
- Closed testing: `400000 + GITHUB_RUN_NUMBER`
- Production: `600000 + GITHUB_RUN_NUMBER`

## Current GitHub Secret State

GitHub environments are configured for release-track-specific config:

- `CyberCache / internal`
- `CyberCache / firebase-distribution`
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

Google native sign-in requires the Android OAuth client to match the exact
installed app signature:

- Local debug APKs use the debug keystore SHA1: `35:4D:73:9E:56:2F:BB:CB:B5:67:1C:EC:0B:0C:BD:29:C6:B3:C9:52`.
- Firebase App Distribution APKs are signed with the upload key SHA1 above.
- Play-distributed AABs are re-signed by Google Play App Signing; add the app
  signing certificate SHA1 from Play Console (`Setup` -> `App integrity`) as a
  separate Android OAuth client/fingerprint.

These app-specific secrets are intentionally not copied from Sportfolio:

- `ADMOB_APP_ID_ANDROID`
- `ADMOB_REWARDED_CACHE_KEY_AD_UNIT_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID`
- `GOOGLE_SERVICES_JSON`
- `FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT`

Use `.env.example` for local web/native development variables and `.env.android.example` as the template for release signing, Play upload, AdMob, and Firebase configuration.

## Runtime Behavior

- The only rewarded-ad entry point is the small plus button in the top cache-key chip.
- The client shows a rewarded ad, then calls `cc_claim_rewarded_cache_key`.
- The Chef increments `profiles.cache_tokens` server-side, with daily cap, cooldown, and idempotency.
- Google sign-in uses native Android Google Sign-In to obtain an ID token, then the Chef verifies it and links/creates the account (B1.5). The Android OAuth client in Google Cloud still needs the package name and signing certificate fingerprints, but the app does not read an Android OAuth JSON file for sign-in.
- Push notification registration only runs in native builds and stores FCM tokens through `cc_register_push_device`.
