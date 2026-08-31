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
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from database import get_db_connection

from helpers import (
    get_all_meters,
    get_all_plants,
)
from services.meter_service import fetch_latest_rows
from services import group_service
from routers.auth import require_login
router = APIRouter()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/plants")
def plants():
    return get_all_plants()


@router.get("/api/meters")
def meters(plant: str = None):
    return [
        {"id": mid, "name": data["name"], "type": data.get("type", "submeter")}
        for mid, data in get_all_meters(plant).items()
    ]


@router.get("/api/latest")
def latest(plant: str = None, meter: str = None):
    if not plant:
        raise HTTPException(status_code=400, detail="plant is required")
    return fetch_latest_rows(plant, meter)


@router.get("/api/group_latest")
def group_latest(request: Request, group_id: int):
    require_login(request)
    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        raise HTTPException(status_code=404, detail="Group not found")
        
    members = group_data["members"]
    if not members:
        return {"group_id": group_id, "name": group_data["name"], "overall_kwh": 0, "meters": []}
        
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    overall_kwh = 0
    meter_results = []
    
    for member in members:
        plant = member["plant"]
        meter_id = member["meter_id"]
        
        cur.execute(
            "SELECT * FROM meter_data WHERE plant=%s AND meter_id=%s "
            "ORDER BY timestamp DESC LIMIT 1",
            (plant, int(meter_id)),
        )
        row = cur.fetchone()
        if row:
            val_kwh = float(row.get("kwh") or 0)
            overall_kwh += val_kwh
            
            normalized = dict(row)
            if isinstance(normalized.get("timestamp"), datetime):
                normalized["timestamp"] = normalized["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
            meter_results.append(normalized)
            
    conn.close()
    
    return {
        "group_id": group_id,
        "name": group_data["name"],
        "overall_kwh": round(overall_kwh, 2),
        "meters": meter_results
    }


@router.get("/api/stream_latest")
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
