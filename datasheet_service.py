import csv
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook

# Clients export the same column under whatever case and punctuation their system uses -
# MOBILE_NO, Mobile No, mobile-no. Matching on the exact string meant a file that held
# every required column was rejected because one header was typed differently.
_HEADER_NOISE = re.compile(r"[^a-z0-9]")

# Words that name the two columns a list cannot work without.
PHONE_WORDS = ("mobile", "phone", "contact", "msisdn", "cell", "number")
NAME_WORDS = ("customer_name", "customername", "custname", "name")


def normalise_header(name: Any) -> str:
    """The comparable form of a column name: case, spaces and punctuation removed."""
    return _HEADER_NOISE.sub("", str(name if name is not None else "").lower())


def find_column(columns: List[str], wanted: str) -> Optional[str]:
    """The column in this file that means `wanted`, however it was typed."""
    if not wanted:
        return None
    target = normalise_header(wanted)
    for column in columns:
        if normalise_header(column) == target:
            return column
    return None


def find_phone_column(columns: List[str]) -> Optional[str]:
    """The number to dial - the one column a call list cannot do without."""
    for word in PHONE_WORDS:
        for column in columns:
            if word in normalise_header(column):
                return column
    return None


def find_name_column(columns: List[str]) -> Optional[str]:
    """Who the customer is, so a row can be recognised by more than its number."""
    for word in NAME_WORDS:
        for column in columns:
            if normalise_header(word) in normalise_header(column):
                return column
    return None


def parse_csv(content: bytes) -> Tuple[List[str], List[Dict[str, Any]]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    columns = [c.strip() for c in (reader.fieldnames or [])]
    rows = [dict(row) for row in reader]
    return columns, rows


def parse_excel(content: bytes) -> Tuple[List[str], List[Dict[str, Any]]]:
    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    rows_iter = sheet.iter_rows(values_only=True)
    header = next(rows_iter, None) or ()
    columns = [str(col).strip() if col is not None else "" for col in header]
    rows: List[Dict[str, Any]] = []
    for values in rows_iter:
        if values is None or all(v is None for v in values):
            continue
        row = {columns[i]: values[i] for i in range(len(columns)) if i < len(values)}
        rows.append(row)
    return columns, rows


def parse_datasheet_file(filename: str, content: bytes) -> Tuple[List[str], List[Dict[str, Any]]]:
    lowered = (filename or "").lower()
    if lowered.endswith(".csv"):
        return parse_csv(content)
    if lowered.endswith(".xlsx") or lowered.endswith(".xlsm"):
        return parse_excel(content)
    raise ValueError("Unsupported file type. Upload a .csv or .xlsx file.")


def validate_columns(columns: List[str], expected_fields: List[str]) -> None:
    """Check the file carries every column the format asks for, whatever the case.

    A header is matched on its letters and digits alone, so MOBILE_NO, Mobile No and
    mobile-no are the same column. The file keeps its own spelling; only the comparison
    is relaxed.
    """
    present = {normalise_header(c): str(c).strip() for c in columns if str(c or "").strip()}
    missing = [
        str(f).strip()
        for f in expected_fields
        if str(f or "").strip() and normalise_header(f) not in present
    ]
    if missing:
        raise ValueError(
            "Uploaded file does not match the template. Missing required columns: "
            f"{', '.join(sorted(missing))}. The file has: "
            f"{', '.join(sorted(present.values())) or '(no columns)'}."
        )
