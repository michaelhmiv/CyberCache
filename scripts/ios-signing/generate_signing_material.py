#!/usr/bin/env python3
"""Prepare CyberCache's iOS signing material with the App Store Connect API.

Shared CI distribution certificate per Michael's 2026-11-20 ruling (team
cert cap; mint-per-build retired): every app's iOS CI uses ONE shared Apple
Distribution certificate, which lives in the IOS_DIST_CERT_* Actions
secrets. This script never creates, revokes, or sweeps certificates.

Flow:
  1. Decode the shared distribution .p12 from IOS_DIST_CERT_P12_BASE64 and
     extract the certificate and private key with openssl into the same
     artifact names the mint-per-build flow produced in SIGN_DIR
     (ci.cer in DER form, ci.pem, ci.key), then stage the .p12 itself as
     distribution.p12 with IOS_DIST_CERT_P12_PASSWORD, so the install step
     in .github/actions/ios-signing consumes exactly the paths and
     environment variables it always has (CYBERCACHE_P12_PATH,
     CYBERCACHE_P12_PASSWORD, CYBERCACHE_PROFILE_PATH).
  2. Resolve the bundle ID record for the app. If it does not exist yet,
     fail with a named blocker: the App Store Connect app record must be
     created first (iOS launch brief, Track 4).
  3. Ensure the Sign in with Apple capability is enabled on the bundle ID
     (the profile must carry it once the app enables the entitlement —
     brief Track 3). A bare create is rejected by Apple, so the
     PRIMARY_APP_CONSENT setting shape is sent, exactly as PitTech's
     working flow does.
  4. Delete the app's previous CI provisioning profile if present, create
     a fresh App Store provisioning profile for the bundle ID referencing
     the shared certificate ID from IOS_DIST_CERT_ID, and download it.
     Profiles are per-app and are not capped.

Inputs (environment):
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY  — Actions secrets.
  IOS_DIST_CERT_P12_BASE64, IOS_DIST_CERT_P12_PASSWORD, IOS_DIST_CERT_ID
    — Actions secrets holding the shared CI distribution certificate.
  IOS_BUNDLE_ID       — default com.michaelhmiv.cybercache
  IOS_PROFILE_NAME    — default "CyberCache App Store CI"
  SIGN_DIR            — working directory for signing material.
"""

import base64
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request

sign_dir = pathlib.Path(os.environ["SIGN_DIR"])
sign_dir.mkdir(parents=True, exist_ok=True)
key_id = os.environ["ASC_KEY_ID"]
issuer_id = os.environ["ASC_ISSUER_ID"]
bundle_identifier = os.environ.get("IOS_BUNDLE_ID", "com.michaelhmiv.cybercache")
profile_name = os.environ.get("IOS_PROFILE_NAME", "CyberCache App Store CI")
shared_cert_id = os.environ["IOS_DIST_CERT_ID"]
shared_p12_password = os.environ["IOS_DIST_CERT_P12_PASSWORD"]

(sign_dir / "AuthKey.p8").write_text(os.environ["ASC_PRIVATE_KEY"])


# ES256 JWT signed with openssl + stdlib only (runner Python is externally
# managed, so pip installs are not an option). Same construction as PitTech.
def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


now = int(time.time())
header = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64url(json.dumps({"iss": issuer_id, "iat": now, "exp": now + 1200,
                             "aud": "appstoreconnect-v1"}, separators=(",", ":")).encode())
(sign_dir / "jwt-input.bin").write_bytes(f"{header}.{payload}".encode())
subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(sign_dir / "AuthKey.p8"),
                "-out", str(sign_dir / "jwt-sig.der"), str(sign_dir / "jwt-input.bin")], check=True)
der = (sign_dir / "jwt-sig.der").read_bytes()
idx = 2 + (der[1] & 0x7F) if der[1] & 0x80 else 2


def read_int(buf, i):
    length = buf[i + 1]
    value = buf[i + 2:i + 2 + length].lstrip(b"\x00").rjust(32, b"\x00")
    return value, i + 2 + length


r, idx = read_int(der, idx)
s, idx = read_int(der, idx)
token = f"{header}.{payload}.{b64url(r + s)}"
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
api = "https://api.appstoreconnect.apple.com/v1"


def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(api + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        raise SystemExit(f"ASC API {method} {path} failed ({error.code}): {error.read().decode()[:600]}")


# 1. Shared CI distribution certificate per Michael's 2026-11-20 ruling
# (team cert cap; mint-per-build retired) — the cert lives in the
# IOS_DIST_CERT_* secrets. Decode the shared .p12 and extract the
# certificate (.cer/.der + .pem) and private key (.pem-format .key) with
# openssl into the same SIGN_DIR artifact names the retired mint flow
# produced, and stage the .p12 at distribution.p12, the path the install
# step consumes via CYBERCACHE_P12_PATH.
shared_p12_bytes = base64.b64decode(os.environ["IOS_DIST_CERT_P12_BASE64"])
shared_p12_path = sign_dir / "shared-distribution.p12"
shared_p12_path.write_bytes(shared_p12_bytes)
subprocess.run(["openssl", "pkcs12", "-in", str(shared_p12_path),
                "-passin", f"pass:{shared_p12_password}",
                "-nocerts", "-nodes", "-out", str(sign_dir / "ci.key")], check=True)
subprocess.run(["openssl", "pkcs12", "-in", str(shared_p12_path),
                "-passin", f"pass:{shared_p12_password}",
                "-clcerts", "-nokeys", "-out", str(sign_dir / "ci.pem")], check=True)
subprocess.run(["openssl", "x509", "-in", str(sign_dir / "ci.pem"),
                "-outform", "DER", "-out", str(sign_dir / "ci.cer")], check=True)
p12_path = sign_dir / "distribution.p12"
p12_path.write_bytes(shared_p12_bytes)
print(f"Using shared distribution certificate {shared_cert_id}")

# 2. Resolve the bundle ID record. Zero records means the App Store
# Connect app record has not been created yet — a named blocker, not a
# signing failure.
bundle_records = call("GET", f"/bundleIds?filter[identifier]={bundle_identifier}&limit=200").get("data", [])
exact_matches = [record for record in bundle_records
                 if record.get("attributes", {}).get("identifier") == bundle_identifier]
if len(exact_matches) != 1:
    returned = ", ".join(
        f"{record.get('attributes', {}).get('identifier')} ({record.get('id')})"
        for record in bundle_records) or "none"
    raise SystemExit(
        f"Expected exactly one bundle ID record with identifier {bundle_identifier}; "
        f"the identifier filter returned {len(bundle_records)} record(s): {returned}. "
        "If none exists, the App Store Connect app record for CyberCache must be "
        "created first (iOS launch brief, Track 4) — CI signing cannot proceed "
        "until it exists.")
bundle_id = exact_matches[0]["id"]


# 3. Ensure the Sign in with Apple capability (brief Track 3).
def ensure_capability(capability_type, settings=None):
    def is_present():
        current = call("GET", f"/bundleIds/{bundle_id}/bundleIdCapabilities").get("data", [])
        return any(c.get("attributes", {}).get("capabilityType") == capability_type for c in current)

    if is_present():
        return
    attributes = {"capabilityType": capability_type}
    if settings is not None:
        attributes["settings"] = settings
    try:
        created_cap = call("POST", "/bundleIdCapabilities", payload={"data": {"type": "bundleIdCapabilities",
            "attributes": attributes,
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_id}}}}})
        print(f"Enabled capability {capability_type} on {bundle_id}: "
              f"{json.dumps(created_cap.get('data', {}).get('attributes', {}))}")
    except SystemExit:
        # A concurrent or earlier run may have created the capability
        # between the presence check and this create; only a create that
        # still leaves the capability missing is a real failure.
        if not is_present():
            raise
        print(f"Capability {capability_type} on {bundle_id} was created concurrently; continuing.")


ensure_capability("APPLE_ID_AUTH", settings=[{"key": "APPLE_ID_AUTH_APP_CONSENT",
    "options": [{"key": "PRIMARY_APP_CONSENT"}]}])

# 4. Create the provisioning profile for the shared certificate.
# Profiles stay per-app and API-driven: delete the previous CI profile if
# present, then create a fresh one referencing the shared cert ID.
profiles = call("GET", "/profiles?filter[name]=" + profile_name.replace(" ", "%20") + "&limit=50").get("data", [])
for profile in profiles:
    call("DELETE", f"/profiles/{profile['id']}")
    print(f"Deleted previous CI profile {profile['id']}")
profile = call("POST", "/profiles", payload={"data": {"type": "profiles", "attributes": {
    "name": profile_name, "profileType": "IOS_APP_STORE"}, "relationships": {
    "bundleId": {"data": {"type": "bundleIds", "id": bundle_id}},
    "certificates": {"data": [{"type": "certificates", "id": shared_cert_id}]}}}})["data"]
profile_path = sign_dir / "CyberCache.mobileprovision"
profile_path.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(f"Created provisioning profile {profile['id']}")

with open(os.environ["GITHUB_ENV"], "a") as env_file:
    env_file.write(f"CYBERCACHE_P12_PATH={p12_path}\n")
    env_file.write(f"CYBERCACHE_P12_PASSWORD={shared_p12_password}\n")
    env_file.write(f"CYBERCACHE_PROFILE_PATH={profile_path}\n")
print("Signing material ready.")
