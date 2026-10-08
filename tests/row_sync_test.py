"""After an attempt, the client's own sheet must hold the result. No network, no calls."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import row_sync


FORMAT = {
    "_id": "fmt1",
    "update_columns_mapping": {
        "DISPOSITION": "model_data.disposition_code|call_info.Disposition",
        "DURATION": "call_info.Duration|call_info.CallDuration",
        "PTP_DATE": "model_data.ptp_date",
        "EXECUTION_ID": "execution_id",
    },
    "attempt_columns": ["DISPOSITION", "DURATION"],
}


class FakeDb:
    ready = True

    def __init__(self, session, row):
        self.session = session
        self.row = row
        self.writes = []
        self.datasheets = self  # find_one below stands in for the collection

    async def get_session(self, _id):
        return self.session

    async def get_datasheet_row(self, _sheet, _index):
        return self.row

    async def find_one(self, _query, _projection=None):
        return {"datasheet_template_id": "fmt1"}

    async def get_datasheet_template(self, _id):
        return FORMAT

    async def update_datasheet_row(self, sheet_id, row_index, **fields):
        self.writes.append((sheet_id, row_index, fields))
        self.row.setdefault("data", {}).update(
            {k[len("data."):]: v for k, v in fields.items() if k.startswith("data.")}
        )
        return True


def session(**extra):
    return {
        "session_id": "s1",
        "datasheet_id": "0123456789abcdef01234567",
        "row_index": 0,
        "execution_id": "exec-9",
        **extra,
    }


async def main():
    # --- an unanswered first attempt ----------------------------------------------------
    db = FakeDb(
        session(model_data={"disposition_code": "NR"}, call_info={"Duration": "0"}),
        {"row_index": 0, "attempt_count": 1, "data": {"CUSTOMER_NAME": "Ghasi Ram"}},
    )
    assert await row_sync.sync_row_from_session(db, "s1") is True
    data = db.row["data"]
    print("after attempt 1:", {k: v for k, v in data.items() if k != "CUSTOMER_NAME"})
    assert data["DISPOSITION"] == "NR" and data["DURATION"] == "0"
    assert data["DISPOSITION_1_ATTEMPT"] == "NR", "the attempt keeps its own copy"
    assert data["ATTEMPT_COUNT"] == 1
    assert data["EXECUTION_ID"] == "exec-9", "a root field is read too"
    assert "PTP_DATE_1_ATTEMPT" not in data, "only the named attempt columns are kept"

    # --- running it again for the same attempt changes nothing ---------------------------
    before = dict(data)
    await row_sync.sync_row_from_session(db, "s1")
    assert db.row["data"] == before, "safe to run from the scorer and a late webhook both"
    print("second run for the same attempt: no change")

    # --- the second attempt reaches the customer, and the first is still there -----------
    db.row["attempt_count"] = 2
    db.session = session(
        model_data={"disposition_code": "PTP", "ptp_date": "12-10-2026"},
        call_info={"Duration": "57"},
    )
    await row_sync.sync_row_from_session(db, "s1")
    data = db.row["data"]
    print("after attempt 2:", {k: v for k, v in data.items() if k != "CUSTOMER_NAME"})
    assert data["DISPOSITION"] == "PTP" and data["DURATION"] == "57"
    assert data["DISPOSITION_1_ATTEMPT"] == "NR", "attempt one survives attempt two"
    assert data["DISPOSITION_2_ATTEMPT"] == "PTP"
    assert data["PTP_DATE"] == "12-10-2026" and data["ATTEMPT_COUNT"] == 2

    # --- calls that belong to no row are left alone --------------------------------------
    loose = FakeDb({"session_id": "s2"}, {"row_index": 0})
    assert await row_sync.sync_row_from_session(loose, "s2") is False
    assert loose.writes == [], "a test call has no sheet to write to"

    missing = FakeDb(None, None)
    assert await row_sync.sync_row_from_session(missing, "nope") is False
    assert await row_sync.sync_row_from_session(missing, None) is False

    # --- a format with no mappings writes nothing rather than failing --------------------
    class NoMapping(FakeDb):
        async def get_datasheet_template(self, _id):
            return {"update_columns_mapping": {}}

    quiet = NoMapping(session(model_data={"disposition_code": "NR"}), {"attempt_count": 1, "data": {}})
    assert await row_sync.sync_row_from_session(quiet, "s1") is False
    assert quiet.writes == []

    print("ALL ROW SYNC TESTS PASSED")


asyncio.run(main())
