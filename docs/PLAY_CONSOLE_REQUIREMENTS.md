# Play Console requirements

This document tracks the app-store compliance details for CyberCache.

## Public URLs

Use these URLs after the latest `master` deploy reaches Railway:

- Privacy policy: `https://cybercache-production.up.railway.app/privacy-policy.html`
- Data deletion: `https://cybercache-production.up.railway.app/data-deletion.html`
- Support: `https://cybercache-production.up.railway.app/support.html`

## App category and contact

- App type: Game
- Category recommendation: Role Playing
- Support email: `michaelhmiv@gmail.com`
- Website/support URL: `https://cybercache-production.up.railway.app/support.html`

## App access

CyberCache supports guest-first access and normal account auth. If Play Console
asks whether special credentials are required for review, choose no as long as
the reviewer can enter the app through guest mode without private credentials.

If guest mode is temporarily disabled in a future release, provide Play Console
with a test account before submitting for review.

## Ads

- Contains ads: Yes
- Ad network: Google AdMob
- Current rewarded use: users may choose to watch a rewarded video to receive a
  server-verified cache key.
- The app should not imply that ads are required for all gameplay.

## Data Safety draft answers

CyberCache collects or processes the following categories:

- Personal info: email address, account identifiers, display name where used.
- App activity: gameplay progress, activity, inventory, rewards, cache keys,
  marketplace/service/crafting/boss state, settings, and app interactions.
- Device or other IDs: Firebase Cloud Messaging token, Google advertising/device
  identifiers as processed by AdMob, and platform/app-version identifiers.
- Diagnostics: crash/error details, request logs, security logs, server logs,
  and related operational diagnostics.

CyberCache uses data for:

- App functionality
- Account management
- Security, fraud prevention, and abuse prevention
- Developer communications and support
- Advertising or marketing through rewarded AdMob ads
- Analytics/diagnostics only through service-provider operational logs unless a
  dedicated analytics SDK is added later

Data sharing disclosures:

- Supabase: authentication and database services.
- Railway: hosting and server logs.
- Google Firebase: push notifications and tester distribution.
- Google AdMob: rewarded ads.
- Google Play: Android app distribution and platform compliance.
- GitHub Actions: build automation and release artifacts.

Security and deletion disclosures:

- Data is encrypted in transit where supported.
- Users can request deletion through
  `https://cybercache-production.up.railway.app/data-deletion.html`.
- Users can also open the deletion request page from Settings -> Danger Zone ->
  Delete Account / Data.
- CyberCache does not sell personal information.

## Content rating notes

Expected questionnaire direction:

- Fantasy/combat theme: Yes.
- Realistic graphic violence or gore: No, unless new assets are added later.
- Gambling with real money: No.
- Purchases or paid loot boxes: No, unless in-app purchases are added later.
- User-generated public content: No, unless social/profile features are expanded.
- Location sharing: No.

## Target audience

Recommended target audience: teens and adults, not children under 13.

Confirm the final age range in Play Console before production submission. If the
app is marked as designed for children, the privacy policy, ads configuration,
content, and data collection disclosures need a separate child-directed review.

## Current release tracks

- Firebase App Distribution is the fast tester-install lane.
- Play internal release is available for quick Play installs.
- Play closed testing currently targets the Play Console `Alpha` closed-testing
  track with draft releases while the app remains in draft status.
