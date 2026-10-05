"""Uploading without choosing a format: reuse one that fits, or make one. No real I/O."""
import asyncio
import io
import os
import sys

sys.path.insert(0, r"C:\Users\rupes\Documents\GitHub\niranjan mama")
os.environ.setdefault("CARTESIA_API_KEY", "test")
os.environ.setdefault("CARTESIA_VOICE_ID", "v1")

import api


class Upload:
    """The bit of UploadFile the endpoint uses."""

    def __init__(self, filename, body):
        self.filename = filename
        self._body = body

    async def read(self):
        return self._body


class FakeDb:
    def __init__(self, formats=()):
        self.formats = {str(i): dict(f, _id=str(i)) for i, f in enumerate(formats)}
        self.created = []
        self.sheets = []

    async def list_datasheet_templates(self):
        return list(self.formats.values())

    async def get_datasheet_template(self, template_id):
        return self.formats.get(str(template_id))

    async def create_datasheet_template(self, data):
        new_id = str(len(self.formats) + 100)
        self.formats[new_id] = dict(data, _id=new_id)
        self.created.append(data)
        return new_id

    async def create_datasheet(self, name, template_id, columns, rows):
        self.sheets.append((name, template_id, columns, len(rows)))
        return "sheet-1"

    async def list_templates(self):
        return []


CSV = b"Customer Name,Mobile_No,FINAL_EMI_AMT\nGhasi Ram,9799689933,5000\nSita,9000000001,7200\n"


async def main():
    # --- a format that already fits is reused, whatever case the file uses -------------
    api.handler.db = FakeDb([
        {"name": "bajaj pdm", "required_columns": ["CUSTOMER_NAME", "MOBILE_NO"],
         "update_columns_mapping": {"DISPOSITION": "model_data.disposition_code"}},
        {"name": "other", "required_columns": ["ACCOUNT_NO"]},
    ])
    result = await api.upload_datasheet(name="Oct list", file=Upload("oct.csv", CSV), datasheet_template_id=None)
    print("reused:", result["format_name"], "| created?", result["format_created"])
    assert result["format_created"] is False and result["format_name"] == "bajaj pdm"
    assert result["row_count"] == 2

    # --- nothing fits, so one is made from the file ------------------------------------
    db = FakeDb([{"name": "other", "required_columns": ["ACCOUNT_NO", "BRANCH"]}])
    api.handler.db = db

    async def fake_plan(columns, row_count, **kwargs):
        return {
            "required_columns": [api._normalise_column(c) for c in columns],
            "update_columns_mapping": {
                "DISPOSITION": "model_data.disposition_code",
                "DURATION": "call_info.Duration",
                "PTP_AMT": "model_data.ptp_amt",
            },
            "placeholders_missing": ["EMI_DATE"],
        }

    api._plan_format = fake_plan
    result = await api.upload_datasheet(name="Fresh list", file=Upload("fresh.csv", CSV), datasheet_template_id=None)
    print("created:", result["format_name"], "| missing placeholders:", result["placeholders_missing"])
    made = db.created[0]
    print("        required:", made["required_columns"])
    print("        per attempt:", made["attempt_columns"])
    assert result["format_created"] is True
    assert made["required_columns"] == ["CUSTOMER_NAME", "MOBILE_NO", "FINAL_EMI_AMT"]
    assert made["attempt_columns"] == ["DISPOSITION", "DURATION"], \
        "only result columns the calls fill are kept per attempt"
    assert result["placeholders_missing"] == ["EMI_DATE"]

    # --- a format chosen by hand is still checked ---------------------------------------
    api.handler.db = FakeDb([{"name": "strict", "required_columns": ["ACCOUNT_NO"]}])
    try:
        await api.upload_datasheet(
            name="Nope", file=Upload("x.csv", CSV), datasheet_template_id="0"
        )
        raise SystemExit("a file missing a required column should be refused")
    except api.HTTPException as exc:
        print("hand-picked format, missing column ->", exc.status_code, str(exc.detail)[:70])
        assert exc.status_code == 400

    # --- an empty file is refused -------------------------------------------------------
    api.handler.db = FakeDb()
    try:
        await api.upload_datasheet(name="Empty", file=Upload("e.csv", b"A,B\n"))
        raise SystemExit("an empty file should be refused")
    except api.HTTPException as exc:
        print("empty file ->", exc.status_code, exc.detail)

    print("ALL AUTO-FORMAT TESTS PASSED")


asyncio.run(main())
