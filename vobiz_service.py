"""Vobiz voice provider: outbound calls plus the XML that opens a bidirectional audio
stream back to this server.

Vobiz's REST surface mirrors Plivo's (``/Account/{auth_id}/Call/`` taking ``from``, ``to``
and ``answer_url``), but three details differ and each one is silent if you get it wrong:

* Authentication is ``X-Auth-ID`` / ``X-Auth-Token`` headers, not HTTP Basic auth.
* Stream messages are keyed on ``type``, where Plivo and Twilio use ``event``.
* Inbound audio arrives with ``payload`` at the top level, not nested under ``media``.

Docs: https://vobiz.ai/docs/xml/stream and https://vobiz.ai/openapi.json
"""

import logging
from typing import Dict, Optional, Tuple
from urllib.parse import quote, urlparse
from xml.sax.saxutils import escape as xml_escape

import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


def sniff_audio_type(audio: bytes) -> str:
    """The real media type of a recording, read from its first bytes.

    A player handed the wrong type refuses to play it, and a browser saving one names the
    file after the type - which is how a perfectly good mp3 came down as ``.bin``.

    An mp3 frame begins with eleven sync bits, so the test is the whole of the first byte
    and the top three of the second, not a list of the byte pairs seen so far: Vobiz's
    8 kHz recordings start ``ff e3`` (MPEG 2.5 Layer III), where a music file would more
    often start ``ff fb``.
    """
    if audio[:3] == b"ID3":
        return "audio/mpeg"
    if len(audio) >= 2 and audio[0] == 0xFF and (audio[1] & 0xE0) == 0xE0:
        return "audio/mpeg"
    if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
        return "audio/wav"
    if audio[:4] == b"OggS":
        return "audio/ogg"
    if audio[4:8] == b"ftyp":
        # An MPEG-4 container - .mp4 for video, .m4a when it holds only audio.
        return "audio/mp4" if audio[8:12] in (b"M4A ", b"M4B ") else "video/mp4"
    return ""


class VobizVoiceService:
    def __init__(self) -> None:
        self.auth_id = settings.VOBIZ_AUTH_ID
        self.auth_token = settings.VOBIZ_AUTH_TOKEN
        self.phone_number = settings.VOBIZ_PHONE_NUMBER
        self.api_base = settings.VOBIZ_API_BASE.rstrip("/")
        # Falls back to the shared tunnel/host so one public URL serves every provider.
        self.webhook_url = (
            settings.VOBIZ_WEBHOOK_BASE_URL or settings.TWILIO_WEBHOOK_BASE_URL or ""
        )
        self.content_type = settings.VOBIZ_STREAM_CONTENT_TYPE
        # Recording is opt-in on Vobiz: no <Record> in the answer XML means no recording
        # exists at all - not here, and not in their dashboard either. Settings can flip
        # these at runtime, which is why they are instance state rather than constants.
        self.record_calls = settings.VOBIZ_RECORD_CALLS
        self.record_max_seconds = settings.VOBIZ_RECORD_MAX_SECONDS
        self.record_format = settings.VOBIZ_RECORD_FORMAT

    def _validate(self) -> None:
        if not self.auth_id or not self.auth_token:
            raise RuntimeError("Vobiz credentials are not configured")

    @property
    def ready(self) -> bool:
        return bool(self.auth_id and self.auth_token)

    def _headers(self) -> Dict[str, str]:
        return {
            "X-Auth-ID": self.auth_id,
            "X-Auth-Token": self.auth_token,
            "Content-Type": "application/json",
        }

    async def make_call(
        self, from_number: str, to_number: str, session_id: str, time_limit: int = 150
    ) -> Dict[str, object]:
        if not session_id:
            error_msg = "Session ID is required for outbound calls"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg, "call_uuid": None, "session_id": session_id}

        try:
            self._validate()
            caller_id = from_number or self.phone_number
            if not caller_id:
                return {
                    "status": "error",
                    "message": "No Vobiz caller id configured (set VOBIZ_PHONE_NUMBER)",
                    "call_uuid": None,
                    "session_id": session_id,
                }

            # Session ids start with "+" (the phone number); unencoded it decodes back as a
            # space and the callback never matches its session.
            sid_q = quote(session_id, safe="")
            # A SIP endpoint ("sip:agent@sip.vobiz.ai") is a valid destination alongside a
            # PSTN number, and must be passed through untouched — only phone numbers get
            # their leading "+" stripped.
            destination = to_number if to_number.lower().startswith("sip:") else to_number.lstrip("+")
            payload = {
                "from": caller_id.lstrip("+"),
                "to": destination,
                "answer_url": f"{self.webhook_url}/webhooks/vobiz/answer?session_id={sid_q}",
                "answer_method": "POST",
                "hangup_url": f"{self.webhook_url}/webhooks/vobiz/hangup?session_id={sid_q}",
                "hangup_method": "POST",
                "time_limit": time_limit,
            }

            async with aiohttp.ClientSession() as session:
                url = f"{self.api_base}/Account/{self.auth_id}/Call/"
                async with session.post(url, json=payload, headers=self._headers()) as response:
                    response_text = await response.text()
                    try:
                        response_data = await response.json()
                    except aiohttp.ContentTypeError:
                        logger.warning("Vobiz response not in JSON format: %s", response_text)
                        response_data = {"error": f"Invalid response: {response_text}"}

                    if response.status in (200, 201, 202):
                        # Only a request_uuid is available now; the real call_uuid arrives on
                        # the answer webhook and on the stream's start event.
                        request_uuid = response_data.get("request_uuid")
                        logger.info(
                            "Vobiz call initiated: %s -> %s, request_uuid: %s",
                            caller_id, to_number, request_uuid,
                        )
                        return {
                            "status": "success",
                            "message": "Call initiated",
                            "call_uuid": request_uuid,
                            "session_id": session_id,
                        }

                    logger.error("Vobiz call initiation failed: %s", response_data)
                    return {
                        "status": "error",
                        "message": f"Call failed: {response_data}",
                        "call_uuid": None,
                        "session_id": session_id,
                    }
        except Exception as exc:
            logger.error("Vobiz call initiation error: %s", exc)
            return {"status": "error", "message": str(exc), "call_uuid": None, "session_id": session_id}

    async def hangup_call(self, call_uuid: str) -> bool:
        if not call_uuid:
            return False
        try:
            self._validate()
            async with aiohttp.ClientSession() as session:
                url = f"{self.api_base}/Account/{self.auth_id}/Call/{call_uuid}"
                async with session.delete(url, headers=self._headers()) as response:
                    if response.status in (200, 202, 204):
                        return True
                    logger.warning(
                        "Vobiz hangup failed for %s: HTTP %s %s",
                        call_uuid, response.status, (await response.text())[:200],
                    )
                    return False
        except Exception as exc:
            logger.warning("Vobiz hangup error for %s: %s", call_uuid, exc)
            return False

    def build_record_element(self, session_id: str) -> str:
        """`<Record>` for the whole conversation, or "" when recording is switched off.

        Three defaults would each quietly ruin this: `maxLength` is 60 seconds, which cuts
        a normal collection call in half; `playBeep` is on, so the customer hears a beep
        before the agent speaks; and `recordSession` is off, which records only what the
        customer says rather than the conversation.
        """
        if not (self.record_calls and self.webhook_url):
            return ""
        callback = xml_escape(
            f"{self.webhook_url.rstrip('/')}/webhooks/vobiz/recording"
            f"?session_id={quote(session_id, safe='')}"
        )
        return (
            f'  <Record recordSession="true" redirect="false" playBeep="false" '
            f'fileFormat="{xml_escape(self.record_format)}" '
            f'maxLength="{int(self.record_max_seconds)}" '
            # Both hooks point here: `action` carries the recording id as it starts,
            # `callbackUrl` carries the finished file. Which of the two a provider
            # actually fires is not worth guessing at.
            f'action="{callback}" callbackUrl="{callback}"/>\n'
        )

    def build_stream_response(self, session_id: str) -> str:
        """XML that forks the call audio to /vobiz-stream in bidirectional mode.

        `keepCallAlive` pauses any following XML until the stream ends, which is what holds
        the call open for the length of the conversation - and also why <Record> has to come
        first. Anything after the stream element runs only once the call is over, so a
        recording asked for down there would never start.
        """
        ws_base = (
            (self.webhook_url or "")
            .rstrip("/")
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        )
        stream_url = xml_escape(f"{ws_base}/vobiz-stream?session_id={quote(session_id, safe='')}")
        content_type = xml_escape(self.content_type)
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f"{self.build_record_element(session_id)}"
            f'  <Stream bidirectional="true" keepCallAlive="true" '
            f'contentType="{content_type}" audioTrack="inbound" '
            f'streamTimeout="86400">{stream_url}</Stream>\n'
            "</Response>"
        )

    def recording_url_allowed(self, url: str) -> bool:
        """Only the carrier's own hosts, so a stored URL cannot aim this server elsewhere."""
        try:
            host = (urlparse(url).hostname or "").lower()
        except ValueError:
            return False
        api_host = (urlparse(self.api_base).hostname or "").lower()
        return bool(host) and (host == api_host or host.endswith(".vobiz.ai") or host == "vobiz.ai")

    async def fetch_recording(self, url: str) -> Tuple[bytes, str]:
        """Download one recording with the account's auth headers.

        Vobiz's recording URLs are not public, so this is the only way the audio reaches a
        browser. Their docs warn that the extension and content-type can disagree with what
        is actually in the file, so the type is read from the first bytes instead.
        """
        self._validate()
        if not self.recording_url_allowed(url):
            raise ValueError(f"refusing to fetch a recording from {url!r}")
        headers = {"X-Auth-ID": self.auth_id, "X-Auth-Token": self.auth_token}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status != 200:
                    body = (await response.text())[:200]
                    raise RuntimeError(f"Vobiz returned {response.status} for the recording: {body}")
                audio = await response.read()
                served_as = (response.headers.get("Content-Type") or "").split(";")[0].strip()
        # The bytes decide. Their header is the fallback when the bytes say nothing, and
        # it is ignored when it says something generic - which is what a download of
        # application/octet-stream would otherwise become.
        if served_as.startswith(("audio/", "video/")):
            return audio, sniff_audio_type(audio) or served_as
        return audio, sniff_audio_type(audio) or "application/octet-stream"

    def build_speak_response(self, text: str) -> str:
        """Plain <Speak> fallback, used only when the stream cannot be opened."""
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f"  <Speak>{xml_escape(text)}</Speak>\n"
            "</Response>"
        )
