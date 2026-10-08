"""Write what a call produced back into the row of the list it came from.

A client uploads a sheet and expects to download the same sheet with the results in it.
Two things stopped that. The dialler was the only thing that wrote results, and it wrote
them the instant the call ended - before the scoring had finished and before the carrier
had sent its hangup details - so DISPOSITION and DURATION landed empty. And a call placed
any other way (Call again on a conversation, a batch from an outcome tile, the dashboard)
never touched the sheet at all, even though the session knew which row it belonged to.

Everything that finishes a call comes through here now. The session says which list and
row it is, the list's format says which columns to fill, and the row is filled for the
attempt it is on. Running it again for the same attempt writes the same values, so it is
safe to call from the scorer and from a late webhook both.
"""

import logging
from typing import Optional

from bson import ObjectId

try:
    from .template_service import apply_update_columns_mapping, attempt_history_updates
    from .result_columns import connected_label
except ImportError:  # pragma: no cover
    from template_service import apply_update_columns_mapping, attempt_history_updates
    from result_columns import connected_label

logger = logging.getLogger(__name__)


async def sync_row_from_session(db, session_id: Optional[str]) -> bool:
    """Fill the datasheet row this call belongs to. Returns whether anything was written."""
    if not session_id or not getattr(db, "ready", False):
        return False
    try:
        session = await db.get_session(session_id)
        if not session:
            return False
        datasheet_id = session.get("datasheet_id")
        row_index = session.get("row_index")
        if not datasheet_id or row_index is None:
            # A test call, or an inbound one: there is no row to write.
            return False
        row_index = int(row_index)

        row = await db.get_datasheet_row(datasheet_id, row_index)
        if row is None:
            return False

        # Only the id, never the rows: a list can hold twenty thousand of them.
        sheet = await db.datasheets.find_one(
            {"_id": ObjectId(datasheet_id)}, {"datasheet_template_id": 1}
        )
        fmt = await db.get_datasheet_template(
            str((sheet or {}).get("datasheet_template_id") or "")
        ) or {}
        mapping = fmt.get("update_columns_mapping") or {}
        if not mapping:
            return False

        # The attempt this row is on. The counter is moved when the call is placed, so this
        # fills the attempt that just happened rather than inventing a new one.
        attempt_no = max(1, int(row.get("attempt_count") or 1))
        # "Connected or not" is the first thing a desk reads, and no provider writes it:
        # the carrier says "completed" for a call nobody picked up. Worked out here so a
        # format can simply map it like any other field.
        session = {**session, "connected": connected_label(session)}
        writes = apply_update_columns_mapping(session, mapping)
        if not writes:
            return False
        writes.update(attempt_history_updates(writes, fmt.get("attempt_columns"), attempt_no))
        writes["data.ATTEMPT_COUNT"] = attempt_no
        await db.update_datasheet_row(datasheet_id, row_index, **writes)
        logger.info(
            "ROW SYNC [%s] list %s row %s attempt %s: %s columns",
            session_id, datasheet_id, row_index, attempt_no, len(writes),
        )
        return True
    except Exception as exc:  # a sheet update must never take a call down with it
        logger.warning("ROW SYNC [%s] failed: %s", session_id, exc)
        return False
