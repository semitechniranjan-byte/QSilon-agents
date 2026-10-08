"""The standard result set, and "connected or not" - which no provider writes for us."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import result_columns as RC


def main():
    columns = [entry["column"] for entry in RC.STANDARD_RESULT_COLUMNS]
    print("standard set:", columns)
    # What a collections desk reads first, in the order it reads it.
    for needed in (
        "DIALED_DATETIME", "BOT/IVR_STATUS", "CUSTOMER_START_TIME", "CUSTOMER_END_TIME",
        "DURATION", "DISPOSITION", "PTP_DATE",
    ):
        assert needed in columns, needed
    assert columns.index("BOT/IVR_STATUS") < columns.index("DISPOSITION")
    assert len(set(columns)) == len(columns), "no column is listed twice"

    per_attempt = RC.standard_attempt_columns()
    print("kept per attempt:", per_attempt)
    assert "DISPOSITION" in per_attempt and "DURATION" in per_attempt
    assert "SUMMARY" not in per_attempt and "EXECUTION_ID" not in per_attempt

    mapping = RC.standard_mapping()
    assert mapping["DISPOSITION"].startswith("model_data.disposition_code")
    assert mapping["BOT/IVR_STATUS"].startswith("connected"), \
        "the worked-out label is tried before the carrier's own word"
    assert set(RC.standard_mapping(["DURATION"])) == {"DURATION"}

    # --- connected or not ---------------------------------------------------------------
    cases = [
        ({"call_info": {"Duration": "57"}}, "CONNECTED", "they spoke for 57 seconds"),
        ({"call_info": {"Duration": "0"}, "disposition_code": "NR"}, "NOT CONNECTED", "nobody picked up"),
        ({"call_info": {"CallStatus": "completed", "Duration": "0"}}, "NOT CONNECTED",
         "the carrier says completed for a call nobody answered"),
        ({"call_info": {"AnswerTime": "2026-10-06 09:03:47"}}, "CONNECTED", "it was answered"),
        ({"model_data": {"disposition_code": "PTP"}}, "CONNECTED", "there is a transcript to score"),
        ({}, "NOT CONNECTED", "nothing to go on"),
    ]
    for session, expected, why in cases:
        got = RC.connected_label(session)
        print("  %-14s %s" % (got, why))
        assert got == expected, (session, got, expected)

    print("ALL RESULT COLUMN TESTS PASSED")


main()
