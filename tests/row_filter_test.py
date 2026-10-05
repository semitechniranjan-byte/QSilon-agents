"""The client's own rules: nothing here is a code this system knows about."""
import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, r"C:\Users\rupes\Documents\GitHub\niranjan mama")
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import row_filter as RF
import api


def row(**data):
    meta = {k: data.pop(k) for k in ("status", "attempt_count", "disposition_code") if k in data}
    return {"row_index": data.pop("i", 0), "data": data, **meta}


COLLECTIONS = [
    row(i=0, CUSTOMER_NAME="Ghasi Ram", MOBILE_NO="9799689933", DISPOSITION="PTP",
        DURATION="57", attempt_count=1, status="completed"),
    row(i=1, CUSTOMER_NAME="Sita Devi", MOBILE_NO="9000000001", DISPOSITION="NR",
        DURATION="0", attempt_count=2, status="no_answer"),
    row(i=2, CUSTOMER_NAME="Amit", MOBILE_NO="9000000002", DISPOSITION="RTP",
        DURATION="31", attempt_count=1, status="completed"),
    row(i=3, CUSTOMER_NAME="Kiran", MOBILE_NO="9000000003", DISPOSITION="NR",
        DURATION="0", attempt_count=3, status="no_answer"),
    row(i=4, CUSTOMER_NAME="Neha", MOBILE_NO="9000000004", DISPOSITION="",
        DURATION="", attempt_count=0, status="queued"),
]

# The same engine, a completely different vocabulary - a clinic's list.
CLINIC = [
    row(i=0, PATIENT="A", APPOINTMENT_STATUS="missed", VISITS=2),
    row(i=1, PATIENT="B", APPOINTMENT_STATUS="attended", VISITS=5),
    row(i=2, PATIENT="C", APPOINTMENT_STATUS="missed", VISITS=0),
]


def names(rows):
    return [r["data"].get("CUSTOMER_NAME") or r["data"].get("PATIENT") for r in rows]


async def main():
    def pick(rows, rules, match="all"):
        return names(RF.filter_rows(rows, {"rules": rules, "match": match}))

    # "Everyone we have not already got a promise from"
    got = pick(COLLECTIONS, [{"field": "DISPOSITION", "op": "not_in", "value": ["PTP", "CLAIM_PAID"]}])
    print("not PTP/CLAIM_PAID ->", got)
    assert got == ["Sita Devi", "Amit", "Kiran", "Neha"]

    # "Nobody picked up" - a duration of zero, whether the sheet says 0 or "0"
    print("duration 0 ->", pick(COLLECTIONS, [{"field": "DURATION", "op": "is", "value": 0}]))
    assert pick(COLLECTIONS, [{"field": "DURATION", "op": "is", "value": "0"}]) == ["Sita Devi", "Kiran"]

    # Two rules together, and the attempt counter the calls now keep
    both = pick(COLLECTIONS, [
        {"field": "DISPOSITION", "op": "is", "value": "NR"},
        {"field": "ATTEMPT_COUNT", "op": "lt", "value": 3},
    ])
    print("NR and under 3 tries ->", both)
    assert both == ["Sita Devi"]

    # Either/or
    either = pick(COLLECTIONS, [
        {"field": "DISPOSITION", "op": "is", "value": "RTP"},
        {"field": "ATTEMPT_COUNT", "op": "gte", "value": 3},
    ], match="any")
    print("RTP or 3+ tries ->", either)
    assert either == ["Amit", "Kiran"]

    # Never called / no outcome yet
    print("no outcome yet ->", pick(COLLECTIONS, [{"field": "DISPOSITION", "op": "is_empty"}]))
    assert pick(COLLECTIONS, [{"field": "DISPOSITION", "op": "is_empty"}]) == ["Neha"]

    # Row-level fields and text search
    assert pick(COLLECTIONS, [{"field": "STATUS", "op": "is", "value": "no_answer"}]) == ["Sita Devi", "Kiran"]
    assert pick(COLLECTIONS, [{"field": "customer name", "op": "contains", "value": "ram"}]) == ["Ghasi Ram"]
    assert pick(COLLECTIONS, [{"field": "ATTEMPT_COUNT", "op": "between", "value": [1, 2]}]) == [
        "Ghasi Ram", "Sita Devi", "Amit"]

    # No rules is no filter
    assert len(RF.filter_rows(COLLECTIONS, {"rules": [], "match": "all"})) == 5
    assert len(RF.filter_rows(COLLECTIONS, None)) == 5

    # A different client, different words, same engine
    clinic = pick(CLINIC, [{"field": "APPOINTMENT_STATUS", "op": "is", "value": "missed"},
                           {"field": "VISITS", "op": "lte", "value": 2}])
    print("clinic: missed and 2 or fewer visits ->", clinic)
    assert clinic == ["A", "C"]

    # --- what the console offers, read out of the list ---------------------------------
    sheet = {
        "name": "Oct list",
        "columns": ["CUSTOMER_NAME", "MOBILE_NO"],
        "rows": COLLECTIONS,
    }

    class FakeDb:
        async def get_datasheet(self, _id):
            return sheet

    api.handler.db = FakeDb()
    fields = await api.datasheet_fields("x")
    by_name = {f["name"]: f for f in fields["fields"]}
    print("fields offered:", [(f["name"], f["source"], f["kind"]) for f in fields["fields"]])
    assert by_name["CUSTOMER_NAME"]["source"] == "list"
    assert by_name["DISPOSITION"]["source"] == "call"
    assert by_name["DURATION"]["kind"] == "number"
    assert by_name["CUSTOMER_NAME"]["values"] != [], "five names is still a short list"
    assert sorted(v["value"] for v in by_name["DISPOSITION"]["values"]) == ["NR", "PTP", "RTP"], \
        "the codes offered are the ones this client's calls produced"
    assert by_name["ATTEMPT_COUNT"]["kind"] == "number"

    count = await api.datasheet_filter_count("x", api.RowFilterRequest(
        rules=[{"field": "DISPOSITION", "op": "not_in", "value": ["PTP"]},
               {"field": "ATTEMPT_COUNT", "op": "lt", "value": 3}],
        match="all",
    ))
    print("count before calling:", count)
    assert count == {"total": 5, "matching": 3}

    print("ALL FILTER TESTS PASSED")


asyncio.run(main())
