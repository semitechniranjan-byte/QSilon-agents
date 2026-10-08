"""The results a client actually reads, in the order they read them.

A format could map any of thirty-odd fields a call produces, and a list of thirty-five
rows is not a thing anyone can check before a run. Almost every client wants the same
short answer per attempt - when we rang, whether it connected, how long it lasted, what
the outcome was, and the promise if there is one - so that set is named here once, with
the paths that find each value and whether it is worth keeping per attempt.

Anything beyond this is still possible; it is simply not what the screen leads with.
"""

from typing import Any, Dict, List, Optional

# column:      what the sheet calls it
# label:       what it means, in a sentence a client would use
# path:        where to read it, first match wins
# per_attempt: whether every attempt keeps its own copy (DISPOSITION_2_ATTEMPT and so on)
STANDARD_RESULT_COLUMNS: List[Dict[str, Any]] = [
    {
        "column": "DIALED_DATETIME",
        "label": "When we rang",
        "path": "created_at",
        "per_attempt": True,
        "group": "call",
    },
    {
        "column": "BOT/IVR_STATUS",
        "label": "Connected or not",
        "path": "connected|call_info.CallStatus|call_status",
        "per_attempt": True,
        "group": "call",
    },
    {
        "column": "CUSTOMER_START_TIME",
        "label": "When they answered",
        "path": "call_info.AnswerTime|call_info.StartTime|call_info.CallStartTime",
        "per_attempt": True,
        "group": "call",
    },
    {
        "column": "CUSTOMER_END_TIME",
        "label": "When the call ended",
        "path": "call_info.EndTime|call_info.CallEndTime|call_info.EndTimeUtc",
        "per_attempt": True,
        "group": "call",
    },
    {
        "column": "DURATION",
        "label": "How long they spoke (seconds)",
        "path": "call_info.Duration|call_info.CallDuration|call_info.BillDuration",
        "per_attempt": True,
        "group": "call",
    },
    {
        "column": "DISPOSITION",
        "label": "What the call came to",
        "path": "model_data.disposition_code|disposition_code|call_info.Disposition",
        "per_attempt": True,
        "group": "outcome",
    },
    {
        "column": "PTP_DATE",
        "label": "Date they promised",
        "path": "model_data.ptp_date",
        "per_attempt": True,
        "group": "outcome",
    },
    {
        "column": "PTP_AMT",
        "label": "Amount they promised",
        "path": "model_data.ptp_amt",
        "per_attempt": True,
        "group": "outcome",
    },
    {
        "column": "ATTEMPT_COUNT",
        "label": "Attempts so far",
        "path": "attempt_count",
        "per_attempt": False,
        "group": "run",
    },
    {
        "column": "SUMMARY",
        "label": "What was said, in a line",
        "path": "model_data.summary",
        "per_attempt": False,
        "group": "outcome",
    },
    {
        "column": "EXECUTION_ID",
        "label": "Which run placed it",
        "path": "execution_id",
        "per_attempt": False,
        "group": "run",
    },
    {
        "column": "RECORDING_URL",
        "label": "Recording",
        "path": "recording_url",
        "per_attempt": False,
        "group": "run",
    },
]

STANDARD_BY_COLUMN: Dict[str, Dict[str, Any]] = {
    entry["column"]: entry for entry in STANDARD_RESULT_COLUMNS
}


def standard_mapping(columns: Optional[List[str]] = None) -> Dict[str, str]:
    """The update mapping for the standard set, or for the named part of it."""
    wanted = set(columns) if columns is not None else None
    return {
        entry["column"]: entry["path"]
        for entry in STANDARD_RESULT_COLUMNS
        if wanted is None or entry["column"] in wanted
    }


def standard_attempt_columns(columns: Optional[List[str]] = None) -> List[str]:
    """Which of those are worth keeping once per attempt."""
    wanted = set(columns) if columns is not None else None
    return [
        entry["column"]
        for entry in STANDARD_RESULT_COLUMNS
        if entry["per_attempt"] and (wanted is None or entry["column"] in wanted)
    ]


def connected_label(session: Dict[str, Any]) -> str:
    """CONNECTED or NOT CONNECTED, from whatever the carrier and the call left behind.

    A client's sheet asks whether the customer was reached, and the raw carrier status
    says things like "completed" for a call nobody picked up.
    """
    info = session.get("call_info") or {}
    for key in ("Duration", "CallDuration", "BillDuration"):
        try:
            if float(str(info.get(key) or "").strip() or 0) > 0:
                return "CONNECTED"
        except (TypeError, ValueError):
            pass
    if str(info.get("AnswerTime") or info.get("CallStartTime") or "").strip():
        return "CONNECTED"
    if str(session.get("disposition_code") or "").upper() in ("NR", "RNR", "NO_ANSWER", "ICR"):
        return "NOT CONNECTED"
    # A call with a transcript was answered, whatever the carrier called it.
    if session.get("model_data") or session.get("hangup_source") == "agent":
        return "CONNECTED"
    return "NOT CONNECTED"
