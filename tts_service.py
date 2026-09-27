import asyncio
import logging
from collections import OrderedDict
from typing import Dict, Tuple

import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)

# The lines an agent says word for word on nearly every call - the closing, the "one
# moment", the "I could not hear you" - were being bought from Cartesia again on every
# call: ~120ms of waiting and a few paise, for audio identical to what it said an hour
# ago. Keeping the finished audio means those turns start speaking immediately.
#
# The cache is on the module, not the instance: every call builds its own service, so an
# instance cache would never see a second hit. Only short lines are kept, which leaves the
# greeting (it carries the customer's name and amount) out of it by nature.
_CACHE_MAX_ENTRIES = 48
_CACHE_MAX_CHARS = 200
# Replayed in pieces rather than in one lump so a caller who talks over it can still cut
# it off - 4096 bytes is about a quarter second of 8kHz 16-bit audio.
_REPLAY_CHUNK_BYTES = 4096

_AUDIO_CACHE: "OrderedDict[Tuple, bytes]" = OrderedDict()
_CACHE_STATS: Dict[str, int] = {"hits": 0, "misses": 0}


def audio_cache_stats() -> Dict[str, int]:
    """Hits, misses and size - for a health or latency page."""
    return {**_CACHE_STATS, "entries": len(_AUDIO_CACHE)}


class CartesiaTTSService:
    def __init__(self) -> None:
        self.api_key = settings.CARTESIA_API_KEY
        self.voice_id = settings.CARTESIA_VOICE_ID
        self.model_id = settings.CARTESIA_MODEL_ID
        self.language = settings.CARTESIA_LANGUAGE
        self.session = None
        self.ready = False
        self.tts_in_progress = False
        self._full_text = ""
        self._last_spoken_text = ""

    def _validate(self) -> None:
        if not self.api_key or not self.voice_id:
            raise RuntimeError("Cartesia credentials are not configured")

    def set_voice(self, voice_id: str = None, model_id: str = None, language: str = None) -> None:
        if voice_id:
            self.voice_id = voice_id
        if model_id:
            self.model_id = model_id
        if language:
            self.language = language

    async def initialize(self) -> bool:
        self._validate()
        # Reuse the existing session across calls; recreating it per call leaks the old
        # one ("Unclosed client session" warnings).
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        self.ready = True
        return True

    def _cache_key(self, text: str, encoding: str, sample_rate: int) -> Tuple:
        # Everything that changes the audio, or a Hindi line would be replayed in the
        # English voice the moment a template switched.
        return (text, self.voice_id, self.model_id, self.language, encoding, sample_rate)

    async def _replay(self, audio: bytes, callback=None) -> bytes:
        """Feed cached audio out the way a live synthesis would."""
        if callback is None:
            return audio
        for start in range(0, len(audio), _REPLAY_CHUNK_BYTES):
            if not self.tts_in_progress:
                break
            await callback(audio[start:start + _REPLAY_CHUNK_BYTES])
            # Let the loop run: without this the whole line is pushed in one go and a
            # barge-in lands after the caller has already heard all of it.
            await asyncio.sleep(0)
        return audio

    async def synthesize(self, text: str, callback=None, encoding: str = "pcm_mulaw", sample_rate: int = 8000) -> bytes:
        if not self.ready or self.session is None:
            await self.initialize()
        self._validate()

        self.tts_in_progress = True
        self._full_text = text
        self._last_spoken_text = ""

        key = self._cache_key(text, encoding, sample_rate)
        cached = _AUDIO_CACHE.get(key)
        if cached is not None:
            _AUDIO_CACHE.move_to_end(key)
            _CACHE_STATS["hits"] += 1
            logger.warning("TTS-CACHE hit (%d bytes): %r", len(cached), text[:60])
            await self._replay(cached, callback)
            self._last_spoken_text = text
            self.tts_in_progress = False
            return cached

        _CACHE_STATS["misses"] += 1
        payload = {
            "model_id": self.model_id,
            "transcript": text,
            "voice": {"mode": "id", "id": self.voice_id},
            "output_format": {"container": "raw", "encoding": encoding, "sample_rate": sample_rate},
            "language": self.language,
        }
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Cartesia-Version": "2026-03-01",
        }
        chunks = []
        completed = True
        async with self.session.post("https://api.cartesia.ai/tts/bytes", json=payload, headers=headers) as response:
            if response.status != 200:
                raise RuntimeError(await response.text())
            async for chunk in response.content.iter_any():
                if chunk:
                    if not self.tts_in_progress:
                        # Cut off by a barge-in: what arrived is half a sentence, and
                        # keeping it would replay half a sentence for ever after.
                        completed = False
                        break
                    chunks.append(chunk)
                    if callback is not None:
                        await callback(chunk)
        audio = b"".join(chunks)
        if completed and audio and len(text) <= _CACHE_MAX_CHARS:
            _AUDIO_CACHE[key] = audio
            _AUDIO_CACHE.move_to_end(key)
            while len(_AUDIO_CACHE) > _CACHE_MAX_ENTRIES:
                _AUDIO_CACHE.popitem(last=False)
        self._last_spoken_text = text
        self.tts_in_progress = False
        return audio

    async def stop(self) -> None:
        self.tts_in_progress = False
        self._last_spoken_text = self._full_text

    def get_last_spoken_text(self) -> str:
        return self._last_spoken_text

    async def close(self) -> None:
        if self.session:
            await self.session.close()
            self.session = None
        self.ready = False
        self.tts_in_progress = False
