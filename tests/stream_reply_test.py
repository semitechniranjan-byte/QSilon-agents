"""Streamed replies, with a fake model and a fake mouth. No network, no calls placed."""
import asyncio
import os
import sys
import time

sys.path.insert(0, r"C:\Users\rupes\Documents\GitHub\niranjan mama")
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import call_handler as CH


class FakeLLM:
    """Yields the given pieces, after the given delay before the first one."""

    def __init__(self, pieces, first_delay=0.0, gap=0.01, fail_after=None):
        self.pieces = pieces
        self.first_delay = first_delay
        self.gap = gap
        self.fail_after = fail_after
        self.supports_streaming = True

    async def stream_response(self, user_input, conversation_history=None):
        await asyncio.sleep(self.first_delay)
        for i, piece in enumerate(self.pieces):
            if self.fail_after is not None and i == self.fail_after:
                raise RuntimeError("stream broke")
            yield piece
            await asyncio.sleep(self.gap)


def handler(llm, backup=None):
    h = CH.CallHandler.__new__(CH.CallHandler)
    h.session_id = "test"
    h.conversation = []
    h.llm = llm
    h.interrupted_mid_speech = False
    h.call_ending = False
    h.should_end_call = False
    h._spoken_bytes = 1000
    h._backup = None
    h.spoken = []
    h.spoken_at = []
    h.started = time.monotonic()

    async def speak(text):
        h.spoken.append(text)
        h.spoken_at.append(round(time.monotonic() - h.started, 2))

    h._speak = speak
    h._backup_llm = lambda: backup
    return h


async def main():
    # --- the splitter itself -----------------------------------------------------------
    cases = [
        ("Namaste, main Roshini bol rahi hoon.", ("Namaste, main Roshini bol rahi hoon.", "")),
        ("Namaste ji", ("", "Namaste ji")),
        ("Ji.", ("", "Ji.")),
        ("Theek hai. Kab tak payment karenge?", ("Theek hai. Kab tak payment karenge?", "")),
        ("आपका EMI बाकी है। कब तक", ("आपका EMI बाकी है।", " कब तक")),
    ]
    for text, want in cases:
        got = CH._take_speakable(text)
        assert got == want, "splitter %r -> %r, wanted %r" % (text, got, want)
    print("splitter: %d cases pass (English, Hindi danda, too-short fragment)" % len(cases))

    # --- spoken while still being written ----------------------------------------------
    h = handler(FakeLLM(["Theek hai ji. ", "Aapka EMI ", "baaki hai. ", "Kab tak karenge?"], gap=0.05))
    text = await h._speak_reply_as_written("kaun bol raha hai")
    print("streamed pieces:", h.spoken, "at", h.spoken_at)
    assert len(h.spoken) >= 2, "spoke in pieces rather than one lump"
    assert h.spoken_at[0] < h.spoken_at[-1], "first piece went out before the last arrived"
    assert text == "Theek hai ji. Aapka EMI baaki hai. Kab tak karenge?"
    assert h._spoken_bytes == 1000 * len(h.spoken), "sign-off wait counts every piece"

    # --- the hedge still works ---------------------------------------------------------
    slow = FakeLLM(["Bahut ", "der se aaya."], first_delay=1.2)
    quick = FakeLLM(["Backup bol raha hai."], first_delay=0.05)
    h = handler(slow, backup=quick)
    t0 = time.monotonic()
    text = await h._speak_reply_as_written("hello")
    took = time.monotonic() - t0
    print("hedge: said %r after %.2fs" % (text, took))
    assert text == "Backup bol raha hai.", "the backup's words are what the caller heard"
    assert took < 1.0, "did not wait out the slow primary"

    # --- a stream that breaks before a word is spoken falls back ------------------------
    h = handler(FakeLLM(["Aadha"], fail_after=0))
    text = await h._speak_reply_as_written("hello")
    print("broken stream, nothing spoken ->", text)
    assert text is None, "caller falls back to the whole-reply path"
    assert h.spoken == []

    # --- a stream that breaks after a sentence keeps what was said ----------------------
    h = handler(FakeLLM(["Theek hai ji. ", "Aur ", "phir"], fail_after=2))
    text = await h._speak_reply_as_written("hello")
    print("broken stream, one sentence spoken ->", repr(text), h.spoken)
    assert text == "Theek hai ji.", "the half-written sentence is not spoken"
    assert h.spoken == ["Theek hai ji."]

    # --- a reply that ends without punctuation is still spoken in full ------------------
    h = handler(FakeLLM(["Theek hai ji. ", "kal shaam tak"]))
    text = await h._speak_reply_as_written("hello")
    print("no full stop at the end ->", repr(text), h.spoken)
    assert text == "Theek hai ji. kal shaam tak", "the tail is spoken when the model finished"

    # --- a barge-in stops the rest of the reply -----------------------------------------
    h = handler(FakeLLM(["Pehla vaakya. ", "Doosra vaakya. ", "Teesra vaakya."], gap=0.05))
    original = h._speak

    async def speak_then_interrupt(text):
        await original(text)
        h.interrupted_mid_speech = True

    h._speak = speak_then_interrupt
    text = await h._speak_reply_as_written("hello")
    print("barge-in after first piece ->", repr(text), h.spoken)
    assert h.spoken == ["Pehla vaakya."], "nothing further was spoken over the caller"

    # --- switched off in settings -------------------------------------------------------
    CH.settings.LLM_STREAM_REPLIES = False
    h = handler(FakeLLM(["Kuch bhi."]))
    assert await h._speak_reply_as_written("hello") is None
    CH.settings.LLM_STREAM_REPLIES = True
    print("switch off -> falls back to the old path")

    print("ALL STREAMING TESTS PASSED")


asyncio.run(main())
