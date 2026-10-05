"""Which rows of a list get called - written by the client, not by us.

Nothing in here knows what PTP, NR or CLAIM_PAID mean. A rule names a field, an operator
and a value; the fields and the values offered in the console are read out of the list
itself. So a collections desk can say "DISPOSITION is not PTP and ATTEMPT_COUNT is under
3", a clinic can say "APPOINTMENT_STATUS is missed", and neither needs a line of code.

A field is either a column of the uploaded file or something the calls wrote back - the
two are searched in that order, by letters and digits alone, so MOBILE_NO and Mobile No
are one field.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    from .datasheet_service import normalise_header
except ImportError:  # pragma: no cover
    from datasheet_service import normalise_header

# What a rule may ask. Kept deliberately small: every one of these reads the same in a
# sentence, which is what the console shows the operator.
OPERATORS = (
    "is", "is_not",
    "in", "not_in",
    "contains", "not_contains",
    "lt", "lte", "gt", "gte",
    "between",
    "is_empty", "is_not_empty",
)

# Fields that belong to the row rather than to a column of the file. Exposed under names a
# person would recognise; a file column of the same name wins, because it is the client's.
ROW_FIELDS = {
    "ATTEMPT_COUNT": "attempt_count",
    "STATUS": "status",
    "DISPOSITION": "disposition_code",
    "LAST_ATTEMPT_AT": "last_attempt_at",
}


def _as_number(value: Any) -> Optional[float]:
    """The numeric reading of a value, or None if it is not a number.

    Sheets arrive with "5,000" and " 57 " in number columns often enough that refusing
    them would make numeric rules useless.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value if value is not None else "").strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value).strip()


def row_value(row: Dict[str, Any], field: str) -> Any:
    """What this row holds for a field, looked up the way a person would expect."""
    if not field:
        return None
    data = row.get("data") or {}
    wanted = normalise_header(field)
    for key, value in data.items():
        if normalise_header(key) == wanted:
            return value
    for name, attribute in ROW_FIELDS.items():
        if normalise_header(name) == wanted:
            return row.get(attribute)
    return row.get(field)


def _compare(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "is_empty":
        return _as_text(actual) == ""
    if operator == "is_not_empty":
        return _as_text(actual) != ""

    if operator in ("in", "not_in"):
        wanted = expected if isinstance(expected, (list, tuple, set)) else [expected]
        hit = any(_as_text(actual).casefold() == _as_text(one).casefold() for one in wanted)
        return hit if operator == "in" else not hit

    if operator == "between":
        pair = expected if isinstance(expected, (list, tuple)) else []
        low, high = (list(pair) + [None, None])[:2]
        number = _as_number(actual)
        low_number, high_number = _as_number(low), _as_number(high)
        if number is None or low_number is None or high_number is None:
            return False
        if low_number > high_number:
            low_number, high_number = high_number, low_number
        return low_number <= number <= high_number

    if operator in ("lt", "lte", "gt", "gte"):
        number, limit = _as_number(actual), _as_number(expected)
        if number is None or limit is None:
            return False
        if operator == "lt":
            return number < limit
        if operator == "lte":
            return number <= limit
        if operator == "gt":
            return number > limit
        return number >= limit

    left, right = _as_text(actual), _as_text(expected)
    if operator in ("contains", "not_contains"):
        hit = right.casefold() in left.casefold()
        return hit if operator == "contains" else not hit

    # "is" compares as numbers when both sides are numbers, so 0 matches "0" and "0.0":
    # a duration column comes back as a string from a CSV and as an int from the calls.
    left_number, right_number = _as_number(actual), _as_number(expected)
    if left_number is not None and right_number is not None:
        same = left_number == right_number
    else:
        same = left.casefold() == right.casefold()
    return same if operator == "is" else not same


def matches(row: Dict[str, Any], rules: List[Dict[str, Any]], match: str = "all") -> bool:
    """Does this row pass? No rules means every row passes - an empty filter is no filter."""
    usable = [r for r in (rules or []) if r.get("field") and r.get("op") in OPERATORS]
    if not usable:
        return True
    results = (
        _compare(row_value(row, str(rule["field"])), str(rule["op"]), rule.get("value"))
        for rule in usable
    )
    return any(results) if str(match).lower() == "any" else all(results)


def filter_rows(
    rows: List[Dict[str, Any]], spec: Optional[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """The rows a run should dial, in their original order."""
    if not spec:
        return list(rows or [])
    rules = spec.get("rules") or []
    if not rules:
        return list(rows or [])
    match = spec.get("match") or "all"
    return [row for row in (rows or []) if matches(row, rules, match)]
