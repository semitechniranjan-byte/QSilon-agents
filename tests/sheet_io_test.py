"""Column matching, attempt-wise write-back and the result export. No database, no calls."""
import asyncio
import csv
import io
import os
import sys

sys.path.insert(0, r"C:\Users\rupes\Documents\GitHub\niranjan mama")
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import datasheet_service as DS
import template_service as TS
import api


async def main():
    # --- headers are matched on their letters, not their spelling ----------------------
    file_columns = ["Mobile_No", "customer name", "FINAL_EMI_AMT", " EMI_Date "]
    DS.validate_columns(file_columns, ["MOBILE_NO", "CUSTOMER_NAME", "final_emi_amt", "EMI_DATE"])
    print("mixed-case file accepted against upper-case format")

    try:
        DS.validate_columns(file_columns, ["MOBILE_NO", "ACCOUNT_NO"])
        raise SystemExit("a genuinely missing column should still be refused")
    except ValueError as exc:
        print("missing column ->", str(exc)[:90])

    assert DS.find_column(file_columns, "MOBILE_NO") == "Mobile_No"
    assert DS.find_column(file_columns, "mobile no") == "Mobile_No"
    assert DS.find_phone_column(file_columns) == "Mobile_No"
    assert DS.find_name_column(file_columns) == "customer name"
    assert DS.find_column(file_columns, "ACCOUNT_NO") is None
    print("phone and name columns found:", DS.find_phone_column(file_columns), "|",
          DS.find_name_column(file_columns))

    # --- each attempt keeps its own result ---------------------------------------------
    mapped = {"data.DISPOSITION": "PTP", "data.DURATION": 57, "data.PTP_AMT": 5000}
    first = TS.attempt_history_updates(mapped, ["DISPOSITION", "DURATION", "EXECUTION_ID"], 1)
    third = TS.attempt_history_updates(mapped, ["DISPOSITION", "DURATION"], 3)
    print("attempt 1 ->", first)
    print("attempt 3 ->", third)
    assert first == {"data.DISPOSITION_1_ATTEMPT": "PTP", "data.DURATION_1_ATTEMPT": 57}
    assert "data.PTP_AMT_1_ATTEMPT" not in first, "only the named attempt columns are kept"
    assert third == {"data.DISPOSITION_3_ATTEMPT": "PTP", "data.DURATION_3_ATTEMPT": 57}
    assert TS.attempt_history_updates(mapped, [], 2) == {}

    # --- the export: input and output in one sheet --------------------------------------
    sheet = {
        "name": "Bajaj Oct list",
        "columns": ["CUSTOMER_NAME", "MOBILE_NO", "FINAL_EMI_AMT"],
        "rows": [
            {
                "row_index": 0,
                "data": {
                    "CUSTOMER_NAME": "Ghasi Ram",
                    "MOBILE_NO": "9799689933",
                    "FINAL_EMI_AMT": 5000,
                    "DISPOSITION": "PTP",
                    "ATTEMPT_COUNT": 2,
                    "DISPOSITION_1_ATTEMPT": "NR",
                    "DURATION_1_ATTEMPT": 0,
                    "DISPOSITION_2_ATTEMPT": "PTP",
                    "DURATION_2_ATTEMPT": 57,
                },
            },
            {
                "row_index": 1,
                "data": {
                    "CUSTOMER_NAME": "Sita Devi",
                    "MOBILE_NO": "9000000001",
                    "FINAL_EMI_AMT": 7200,
                    "DISPOSITION": "NR",
                    "ATTEMPT_COUNT": 1,
                    "DISPOSITION_1_ATTEMPT": "NR",
                    "DURATION_1_ATTEMPT": 0,
                },
            },
        ],
    }

    class FakeDb:
        async def get_datasheet(self, _id):
            return sheet

    api.handler.db = FakeDb()
    response = await api.export_datasheet_csv("any")
    text = response.body.decode("utf-8-sig")
    table = list(csv.reader(io.StringIO(text)))
    print("header:", table[0])
    print("row 1 :", table[1])
    assert table[0] == [
        "CUSTOMER_NAME", "MOBILE_NO", "FINAL_EMI_AMT",
        "DISPOSITION", "ATTEMPT_COUNT",
        "DISPOSITION_1_ATTEMPT", "DURATION_1_ATTEMPT",
        "DISPOSITION_2_ATTEMPT", "DURATION_2_ATTEMPT",
    ], "uploaded columns, then the latest result, then attempt by attempt"
    assert table[1][:5] == ["Ghasi Ram", "9799689933", "5000", "PTP", "2"]
    assert table[2][7:] == ["", ""], "a customer called once leaves the second attempt blank"
    assert "Bajaj-Oct-list-results" in response.headers["Content-Disposition"]
    print("filename:", response.headers["Content-Disposition"])

    print("ALL SHEET TESTS PASSED")


asyncio.run(main())
