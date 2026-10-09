"""Call recording: asking for it, serving it, and refusing what is not ours.

No network, no database, no calls - the XML is built and read back, and the links are
signed and checked in process.
"""
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")
os.environ.setdefault("VOBIZ_AUTH_ID", "acct")
os.environ.setdefault("VOBIZ_AUTH_TOKEN", "secret")
os.environ.setdefault("VOBIZ_WEBHOOK_BASE_URL", "https://calls.example.com")

import recording_links  # noqa: E402
from vobiz_service import VobizVoiceService, sniff_audio_type  # noqa: E402


def service(**overrides) -> VobizVoiceService:
    svc = VobizVoiceService()
    svc.webhook_url = "https://calls.example.com"
    svc.auth_id, svc.auth_token = "acct", "secret"
    for key, value in overrides.items():
        setattr(svc, key, value)
    return svc


# --- the answer XML -----------------------------------------------------------------

SESSION = "+919876543210"

svc = service(record_calls=True, record_max_seconds=900, record_format="mp3")
xml = svc.build_stream_response(SESSION)
root = ET.fromstring(xml)
children = [child.tag for child in root]
assert children == ["Record", "Stream"], children
print("answer XML elements:", children)

record = root.find("Record")
assert record.get("recordSession") == "true", "only the customer would be recorded"
assert record.get("redirect") == "false", "the callback must not drive the call"
assert record.get("playBeep") == "false", "a beep before the agent speaks"
assert record.get("maxLength") == "900", "the default 60 would cut the call short"
assert record.get("fileFormat") == "mp3"
for attr in ("action", "callbackUrl"):
    url = record.get(attr)
    assert url.startswith("https://calls.example.com/webhooks/vobiz/recording?session_id=")
    # "+" unencoded comes back as a space and the callback would match no session.
    assert "%2B919876543210" in url, url
print("record element:", {k: record.get(k) for k in ("recordSession", "maxLength", "playBeep")})

# Order is the whole point: keepCallAlive makes Stream exclusive, so anything after it
# runs only once the call is over.
assert xml.index("<Record") < xml.index("<Stream"), "Record must come first"

off = service(record_calls=False).build_stream_response(SESSION)
assert "<Record" not in off, off
assert "<Stream" in off
print("switched off -> no Record element, stream unchanged")

no_host = service(record_calls=True)
no_host.webhook_url = ""
assert "<Record" not in no_host.build_stream_response(SESSION)
print("no public URL -> nothing to call back to, so nothing is asked for")

# A single quote in a session id must not break the attribute it sits in.
ET.fromstring(service(record_calls=True).build_stream_response('a"b&c'))
print("odd session id still produces valid XML")


# --- signed links -------------------------------------------------------------------

token = recording_links.sign(SESSION)
assert recording_links.verify(SESSION, token)
assert not recording_links.verify("+910000000000", token), "a link must name one call"
assert not recording_links.verify(SESSION, None)
assert not recording_links.verify(SESSION, "")
assert not recording_links.verify(SESSION, "not-a-token")
assert not recording_links.verify(SESSION, token.replace(".", ".0", 1)), "tampered signature"

expiry, _, digest = token.partition(".")
forged = f"{int(expiry) + 86400}.{digest}"
assert not recording_links.verify(SESSION, forged), "the expiry is signed, not just carried"

expired = recording_links.sign(SESSION, ttl_seconds=1)
exp_at, _, _sig = expired.partition(".")
assert int(exp_at) <= int(time.time()) + 1
assert not recording_links.verify(SESSION, f"{int(time.time()) - 10}.{_sig}")
print("signatures: valid, wrong call, tampered, re-dated and expired all behave")

url = recording_links.playback_url("https://calls.example.com/", SESSION)
assert url.startswith("https://calls.example.com/recordings/%2B919876543210?t=")
print("playback url:", url[:72] + "…")


# --- what this server may fetch -----------------------------------------------------

allowed = service()
for ok in (
    "https://api.vobiz.ai/api/v1/Account/a/Recording/r.mp3",
    "https://media.vobiz.ai/x.mp3",
    "https://vobiz.ai/x.mp3",
):
    assert allowed.recording_url_allowed(ok), ok
for bad in (
    "https://vobiz.ai.evil.com/x.mp3",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8000/admin",
    "file:///etc/passwd",
    "",
):
    assert not allowed.recording_url_allowed(bad), bad
print("only the carrier's own hosts are fetched")


# --- the file's real type -----------------------------------------------------------

assert sniff_audio_type(b"ID3\x04\x00") == "audio/mpeg"
assert sniff_audio_type(b"\xff\xfb\x90\x00") == "audio/mpeg"
assert sniff_audio_type(b"RIFF\x24\x00\x00\x00WAVEfmt ") == "audio/wav"
assert sniff_audio_type(b"OggS\x00\x02") == "audio/ogg"
assert sniff_audio_type(b"<html>not audio") == "application/octet-stream"
assert sniff_audio_type(b"") == "application/octet-stream"
print("audio type read from the first bytes, not the extension")

print("ALL RECORDING TESTS PASSED")
