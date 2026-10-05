"""Batch recall: who gets called, who does not, and what Stop does. No real calls."""
import asyncio
import os
import sys

sys.path.insert(0, r"C:\Users\rupes\Documents\GitHub\niranjan mama")
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import api


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d

        return gen()


class FakeSessions:
    def __init__(self, docs):
        self.docs = docs
        self.last_query = None

    def find(self, query, fields=None):
        self.last_query = query
        return FakeCursor(list(self.docs))


class FakeDb:
    def __init__(self, docs, dnc=()):
        self.sessions = FakeSessions(docs)
        self.dnc = {d[-10:] for d in dnc}

    @staticmethod
    def normalise_number(phone):
        digits = "".join(c for c in (phone or "") if c.isdigit())
        return digits[-10:]

    async def is_suppressed(self, phone):
        return {"reason": "asked not to be called"} if self.normalise_number(phone) in self.dnc else None

    async def get_app_settings(self):
        return {}


def _answer(value):
    """A plain value, handed back the way an async driver would."""

    async def coro():
        return value

    return coro()


def session(number, sid):
    return {
        "session_id": sid,
        "phone_number": number,
        "format_values": {"CUSTOMER_NAME": "Test"},
        "dynamic_fields": {},
        "use_case": "emi_collection",
        "language": "hindi",
    }


async def main():
    # The real PTP list: the same customer appears once per attempt.
    docs = [
        session("+916299515059", "a"),
        session("+916299515059", "b"),
        session("+916299515059", "c"),
        session("+919739961339", "d"),
        session("+919945479006", "e"),
        session("", "f"),
        session("unknown", "g"),
        session("+917005290974", "h"),
    ]
    api.handler.db = FakeDb(docs, dnc=["9945479006"])
    api.campaign_service._within_calling_hours = lambda *a, **k: True
    api.campaign_service._calling_window = lambda *a, **k: (9, 19)

    waited = []

    async def fake_wait(db, session_id, timeout=0):
        waited.append(session_id)

    api.campaign_service._wait_for_session_end = fake_wait

    dialled = []

    async def fake_call(payload):
        dialled.append(payload.to_number)
        return {"session_id": "new-%d" % len(dialled)}

    api.create_outbound_call = fake_call

    # --- who is in the batch -----------------------------------------------------------
    req = api.RecallBatchRequest(disposition="PTP,FPTP")
    targets, skipped, rows = await api._recall_targets(req)
    print("targets:", [t["phone_number"] for t in targets], "| skipped as do-not-call:", skipped,
          "| rows read:", rows)
    assert [t["phone_number"] for t in targets] == ["+916299515059", "+919739961339", "+917005290974"]
    assert skipped == 1
    assert api.handler.db.sessions.last_query["disposition_code"] == {"$in": ["PTP", "FPTP"]}

    # --- the preview the confirmation box reads ----------------------------------------
    api.handler.db.sessions.count_documents = lambda q: _answer(len(docs))
    preview = await api.recall_batch_preview(req)
    print("preview:", preview)
    assert preview["customers"] == 3 and preview["calls_in_list"] == len(docs)
    assert preview["skipped_dnc"] == 1 and preview["capped"] is False

    # --- the limit counts PEOPLE, not rows ---------------------------------------------
    few, _, _ = await api._recall_targets(api.RecallBatchRequest(disposition="PTP,FPTP", limit=2))
    print("limit=2 ->", [t["phone_number"] for t in few])
    assert len(few) == 2, "two customers, not the two newest rows of one customer"
    capped = await api.recall_batch_preview(api.RecallBatchRequest(disposition="PTP,FPTP", limit=2))
    assert capped["capped"] is True

    # --- the run itself ----------------------------------------------------------------
    run = await api.recall_batch(req)
    print("started:", run)
    assert run["total"] == 3 and run["skipped_dnc"] == 1
    for _ in range(50):
        await asyncio.sleep(0.02)
        if api._recall_runs[run["run_id"]]["status"] != "running":
            break
    state = api._recall_run_view(api._recall_runs[run["run_id"]])
    print("finished:", state, "| dialled:", dialled)
    assert state["status"] == "done" and state["placed"] == 3 and state["failed"] == 0
    assert dialled == ["+916299515059", "+919739961339", "+917005290974"]
    assert len(waited) == 3, "each call is waited out before the next slot is taken"

    # --- stop -------------------------------------------------------------------------
    dialled.clear()
    slow_started = asyncio.Event()

    async def slow_call(payload):
        dialled.append(payload.to_number)
        slow_started.set()
        await asyncio.sleep(0.3)
        return {"session_id": "s"}

    api.create_outbound_call = slow_call
    run2 = await api.recall_batch(api.RecallBatchRequest(disposition="PTP,FPTP"))
    await slow_started.wait()
    await api.recall_batch_stop(run2["run_id"])
    for _ in range(60):
        await asyncio.sleep(0.02)
        if api._recall_runs[run2["run_id"]]["status"] != "running":
            break
    print("after stop:", api._recall_run_view(api._recall_runs[run2["run_id"]]), "| dialled:", dialled)
    assert api._recall_runs[run2["run_id"]]["status"] == "stopped"
    assert len(dialled) == 1, "nothing new was dialled after Stop"

    # --- outside calling hours ----------------------------------------------------------
    api.campaign_service._within_calling_hours = lambda *a, **k: False
    try:
        await api.recall_batch(api.RecallBatchRequest(disposition="PTP,FPTP"))
        raise SystemExit("should have refused outside calling hours")
    except api.HTTPException as exc:
        print("outside hours ->", exc.status_code, exc.detail)
        assert exc.status_code == 409

    # --- a filter with nobody in it -----------------------------------------------------
    api.campaign_service._within_calling_hours = lambda *a, **k: True
    api.handler.db = FakeDb([], dnc=[])
    try:
        await api.recall_batch(api.RecallBatchRequest(disposition="CB"))
        raise SystemExit("should have refused an empty filter")
    except api.HTTPException as exc:
        print("empty filter ->", exc.status_code, exc.detail)
        assert exc.status_code == 400

    print("ALL BATCH RECALL TESTS PASSED")


asyncio.run(main())
