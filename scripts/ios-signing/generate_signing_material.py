#!/usr/bin/env python3
"""Mint CyberCache's iOS signing material with the App Store Connect API.

Mirrors the PitTech CI signing pattern (repo michaelhmiv/PitTech,
.github/workflows/ios-build.yml): the runner creates its own distribution
certificate and App Store provisioning profile through the ASC API, so no
signing material ever lives in the repo or on a local machine.

Flow (same order as PitTech, for the same reasons):
  1. Delete the previous CI profile and revoke its certificate, freeing
     Apple's single distribution-certificate slot.
  2. Sweep for orphaned distribution certificates (a run that died between
     minting a certificate and creating its profile leaves one behind, and
     it holds the slot against every later run). A certificate referenced
     by ANY profile is never touched.
  3. Generate a fresh key + CSR on this runner; the private key never
     leaves it. Create a DISTRIBUTION certificate from the CSR.
  4. Resolve the bundle ID record for the app. If it does not exist yet,
     fail with a named blocker: the App Store Connect app record must be
     created first (iOS launch brief, Track 4).
  5. Ensure the Sign in with Apple capability is enabled on the bundle ID
     (the CI-minted profile must carry it once the app enables the
     entitlement — brief Track 3). A bare create is rejected by Apple, so
     the PRIMARY_APP_CONSENT setting shape is sent, exactly as PitTech's
     working flow does.
  6. Create the App Store provisioning profile, bundle cert + key into a
     .p12, and export paths for the install step via GITHUB_ENV.

Inputs (environment):
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY  — Actions secrets.
  IOS_BUNDLE_ID       — default com.michaelhmiv.cybercache
  IOS_PROFILE_NAME    — default "CyberCache App Store CI"
  IOS_CERT_CN         — default "CyberCache CI"
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
cert_cn = os.environ.get("IOS_CERT_CN", "CyberCache CI")

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


def get_all(path):
    items = []
    while path is not None:
        page = call("GET", path)
        items.extend(page.get("data", []))
        next_link = page.get("links", {}).get("next")
        path = next_link[len(api):] if next_link else None
    return items


# 1. Free the distribution-certificate slot held by the previous CI run.
# Apple overrides the subject name on distribution certs, so the CI cert
# cannot be found by name; find it through the CI profile, whose name IS
# ours to choose, then delete the profile and revoke its cert.
old_profiles = call("GET", "/profiles?filter[name]=" + profile_name.replace(" ", "%20") + "&limit=50").get("data", [])
old_cert_ids = []
for old_profile in old_profiles:
    linked = call("GET", f"/profiles/{old_profile['id']}/certificates").get("data", [])
    old_cert_ids.extend(cert["id"] for cert in linked)
for old_profile in old_profiles:
    call("DELETE", f"/profiles/{old_profile['id']}")
    print(f"Deleted previous CI profile {old_profile['id']}")
for cert_id in dict.fromkeys(old_cert_ids):
    call("DELETE", f"/certificates/{cert_id}")
    print(f"Revoked previous CI certificate {cert_id}")

# 2. Orphan sweep: revoke distribution-family certificates that NO
# provisioning profile references.
referenced_cert_ids = set()
for any_profile in get_all("/profiles?limit=200"):
    linked = call("GET", f"/profiles/{any_profile['id']}/certificates").get("data", [])
    referenced_cert_ids.update(cert["id"] for cert in linked)
distribution_types = {"DISTRIBUTION", "IOS_DISTRIBUTION", "MAC_APP_DISTRIBUTION"}
orphan_candidates = []
for certificate in get_all("/certificates?limit=200"):
    cert_type = certificate.get("attributes", {}).get("certificateType")
    if cert_type not in distribution_types:
        continue
    if certificate["id"] in referenced_cert_ids:
        print(f"Distribution certificate {certificate['id']} ({cert_type}) is referenced "
              "by a profile; leaving it alone")
    else:
        orphan_candidates.append(certificate)
        print(f"Orphan candidate: distribution certificate {certificate['id']} "
              f"({cert_type}) is referenced by no profile")
for orphan in orphan_candidates:
    call("DELETE", f"/certificates/{orphan['id']}")
    print(f"Revoked orphaned distribution certificate {orphan['id']}")
if not orphan_candidates:
    print("No orphaned distribution certificates found")

# 3. Fresh key + CSR on this runner; create the distribution certificate.
subprocess.run(["openssl", "genrsa", "-out", str(sign_dir / "ci.key"), "2048"], check=True)
subprocess.run(["openssl", "req", "-new", "-key", str(sign_dir / "ci.key"),
                "-out", str(sign_dir / "ci.csr"), "-subj", f"/CN={cert_cn}"], check=True)
csr = (sign_dir / "ci.csr").read_text()
created = call("POST", "/certificates", payload={"data": {"type": "certificates", "attributes": {
    "certificateType": "DISTRIBUTION", "csrContent": csr}}})["data"]
(sign_dir / "ci.cer").write_bytes(base64.b64decode(created["attributes"]["certificateContent"]))
print(f"Created distribution certificate {created['id']}")

# 4. Resolve the bundle ID record. Zero records means the App Store
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


# 5. Ensure the Sign in with Apple capability (brief Track 3).
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

# 6. Create the provisioning profile and the .p12 bundle.
profiles = call("GET", "/profiles?filter[name]=" + profile_name.replace(" ", "%20") + "&limit=50").get("data", [])
for profile in profiles:
    call("DELETE", f"/profiles/{profile['id']}")
    print(f"Deleted previous CI profile {profile['id']}")
profile = call("POST", "/profiles", payload={"data": {"type": "profiles", "attributes": {
    "name": profile_name, "profileType": "IOS_APP_STORE"}, "relationships": {
    "bundleId": {"data": {"type": "bundleIds", "id": bundle_id}},
    "certificates": {"data": [{"type": "certificates", "id": created["id"]}]}}}})["data"]
profile_path = sign_dir / "CyberCache.mobileprovision"
profile_path.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(f"Created provisioning profile {profile['id']}")

subprocess.run(["openssl", "x509", "-inform", "DER", "-in", str(sign_dir / "ci.cer"),
                "-out", str(sign_dir / "ci.pem")], check=True)
p12_password = subprocess.run(["uuidgen"], capture_output=True, text=True, check=True).stdout.strip()
p12_path = sign_dir / "distribution.p12"
subprocess.run(["openssl", "pkcs12", "-export", "-inkey", str(sign_dir / "ci.key"),
                "-in", str(sign_dir / "ci.pem"), "-out", str(p12_path),
                "-passout", f"pass:{p12_password}", "-name", cert_cn], check=True)
with open(os.environ["GITHUB_ENV"], "a") as env_file:
    env_file.write(f"CYBERCACHE_P12_PATH={p12_path}\n")
    env_file.write(f"CYBERCACHE_P12_PASSWORD={p12_password}\n")
    env_file.write(f"CYBERCACHE_PROFILE_PATH={profile_path}\n")
print("Signing material ready.")
