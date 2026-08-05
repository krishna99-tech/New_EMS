"""
routers/meters.py — plant / meter discovery and live-data routes.

Routes:
  GET /plants
  GET /meters
  GET /latest
  GET /stream_latest
"""

import asyncio
import json
from datetime import datetime

import psycopg2.extras
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from database import get_db_connection
from helpers import (
    compute_live_status,
    get_all_meters,
    get_all_plants,
)

router = APIRouter()


# ── Internal helper ────────────────────────────────────────────────────────────

def fetch_latest_rows(plant, meter, conn=None):
    """
    Return the most-recent meter_data row(s) for the given plant/meter.
    Pass an open connection to reuse it (e.g. inside a long-lived SSE stream).
    """
    own_conn = conn is None
    if own_conn:
        conn = get_db_connection()

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if meter == "all":
        meters_dict = get_all_meters(str(plant))
        rows = []
        for meter_id, meta in meters_dict.items():
            cur.execute(
                "SELECT * FROM meter_data WHERE plant=%s AND meter_id=%s "
                "ORDER BY timestamp DESC LIMIT 1",
                (str(plant), int(meter_id)),
            )
            row = cur.fetchone()
            if not row:
                continue
            normalized = dict(row)
            if isinstance(normalized.get("timestamp"), datetime):
                normalized["timestamp"] = normalized["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
            normalized["meter_name"] = meta.get("name", normalized.get("meter_name"))
            normalized["meter_type"] = meta.get("type", normalized.get("meter_type"))
            normalized["status"] = compute_live_status(normalized)
            rows.append(normalized)
        rows.sort(key=lambda r: (r.get("meter_name") or ""))
        if own_conn:
            conn.close()
        return rows

    # Single meter
    query = "SELECT * FROM meter_data WHERE plant=%s AND meter_id=%s ORDER BY timestamp DESC LIMIT 1"
    try:
        params = (str(plant), int(meter))
    except (ValueError, TypeError):
        params = (str(plant), str(meter))

    cur.execute(query, params)
    rows = []
    for r in cur.fetchall():
        normalized = dict(r)
        if isinstance(normalized.get("timestamp"), datetime):
            normalized["timestamp"] = normalized["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
        normalized["status"] = compute_live_status(normalized)
        rows.append(normalized)

    if own_conn:
        conn.close()
    return rows


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/plants")
def plants():
    return get_all_plants()


@router.get("/meters")
def meters(plant: str = None):
    return [
        {"id": mid, "name": data["name"], "type": data.get("type", "submeter")}
        for mid, data in get_all_meters(plant).items()
    ]


@router.get("/latest")
def latest(plant: str = None, meter: str = None):
    return fetch_latest_rows(plant, meter)


@router.get("/stream_latest")
async def stream_latest(plant: str = None, meter: str = None):
    if not plant or not meter:
        raise HTTPException(status_code=400, detail="plant and meter are required")

    async def generate():
        last_signature = None
        conn = get_db_connection()
        while True:
            try:
                rows = await asyncio.to_thread(fetch_latest_rows, plant, meter, conn)
                signature = (
                    "|".join(f"{r.get('meter_id')}:{r.get('id')}" for r in rows)
                    if rows else "empty"
                )
                if signature != last_signature:
                    payload = {
                        "plant": plant,
                        "meter": meter,
                        "rows": rows,
                        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                    yield f"event: latest\ndata: {json.dumps(payload)}\n\n"
                    last_signature = signature
                else:
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err_payload = {"message": str(e)[:180]}
                yield f"event: error\ndata: {json.dumps(err_payload)}\n\n"
                try:
                    conn.close()
                except Exception:
                    pass
                conn = get_db_connection()
            await asyncio.sleep(2)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
