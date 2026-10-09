"""Signed links to a call recording.

The carrier keeps the audio behind the account's own auth headers: the URL it hands back
is not public, an ``<audio>`` tag cannot send headers, and a client opening a report has
no credentials at all. So nothing links to the carrier directly. A recording is served
from this app instead, and the link carries a signature rather than a secret: it names
one session, it expires, and a link that leaks opens that one call and nothing else.

The signature is an HMAC of the session and the expiry under the app's API key, so a
leaked link cannot be edited into a link for another call, and no new secret has to be
deployed for this to work.
"""

import hashlib
import hmac
import time
from typing import Optional
from urllib.parse import quote

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

# Long enough that a report opened weeks later still plays. Short enough that a link
# pasted somewhere public stops working eventually.
DEFAULT_TTL_SECONDS = max(1, settings.RECORDING_LINK_DAYS) * 24 * 3600


def _digest(session_id: str, expires_at: int) -> str:
    message = f"{session_id}:{expires_at}".encode("utf-8")
    key = (settings.API_KEY or "dev-key").encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()[:32]


def sign(session_id: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    """The ``t`` parameter for one session's recording link."""
    expires_at = int(time.time()) + max(1, ttl_seconds)
    return f"{expires_at}.{_digest(session_id, expires_at)}"


def verify(session_id: str, token: Optional[str]) -> bool:
    """True when `token` was signed for this session and has not expired."""
    if not session_id or not token or "." not in token:
        return False
    raw_expiry, _, signature = token.partition(".")
    try:
        expires_at = int(raw_expiry)
    except ValueError:
        return False
    if expires_at < int(time.time()):
        return False
    # Constant time: a timing difference here would let a signature be guessed byte by byte.
    return hmac.compare_digest(signature, _digest(session_id, expires_at))


def playback_url(base_url: str, session_id: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    """The link a report, a sheet or a player should use for this recording."""
    base = (base_url or "").rstrip("/")
    return f"{base}/recordings/{quote(session_id, safe='')}?t={sign(session_id, ttl_seconds)}"
