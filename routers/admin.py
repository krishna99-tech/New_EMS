"""
routers/admin.py — admin UI and CRUD routes for plants & meter configs.

Routes:
  GET    /admin
  POST   /api/plants
  DELETE /api/plants/{plant_name}
  GET    /api/meter_config
  POST   /api/meter_config
  DELETE /api/meter_config/{config_id}
  GET    /api/export_config
  POST   /api/import_config
"""

import json

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.templating import Jinja2Templates

from config import BASE_DIR
from database import get_db_connection
from routers.auth import require_login

import os

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


# ── Admin UI ───────────────────────────────────────────────────────────────────

@router.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    require_login(request)
    return templates.TemplateResponse("admin.html", {"request": request})


# ── Plants CRUD ────────────────────────────────────────────────────────────────

@router.post("/api/plants")
async def add_plant(request: Request):
    require_login(request)
    data = await request.json()
    plant_name = data.get("name")
    if not plant_name:
        raise HTTPException(status_code=400, detail="Plant name is required")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO plants (name) VALUES (%s)", (plant_name,))
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Plant already exists")
    conn.close()
    return {"success": True}


@router.delete("/api/plants/{plant_name}")
def delete_plant(plant_name: str, request: Request, delete_data: str = "false"):
    require_login(request)
    do_delete = delete_data.lower() == "true"
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM plants WHERE name=%s", (plant_name,))
        cur.execute("DELETE FROM meter_config WHERE plant=%s", (plant_name,))
        if do_delete:
            cur.execute("DELETE FROM meter_data WHERE plant=%s", (plant_name,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"success": True}


# ── Meter config CRUD ──────────────────────────────────────────────────────────

@router.get("/api/meter_config")
def get_meter_configs(request: Request):
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, plant, meter_id, name, type FROM meter_config ORDER BY plant, meter_id")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/api/meter_config")
async def save_meter_config(request: Request):
    require_login(request)
    data = await request.json()
    plant    = data.get("plant")
    meter_id = data.get("meter_id")
    name     = data.get("name")
    m_type   = data.get("type", "submeter")

    if not plant or not meter_id or not name:
        raise HTTPException(status_code=400, detail="Missing fields")

    try:
        meter_id = int(meter_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Meter ID must be an integer")

    conn = get_db_connection()
    cur = conn.cursor()

    if m_type == "incomer":
        cur.execute(
            "SELECT id FROM meter_config WHERE plant=%s AND type='incomer' AND meter_id!=%s",
            (plant, meter_id),
        )
        if cur.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="Only one incomer is allowed per plant")

    cur.execute("SELECT id FROM meter_config WHERE plant=%s AND meter_id=%s", (plant, meter_id))
    existing = cur.fetchone()

    if existing:
        cur.execute(
            "UPDATE meter_config SET name=%s, type=%s WHERE id=%s",
            (name, m_type, existing[0]),
        )
    else:
        cur.execute(
            "INSERT INTO meter_config (plant, meter_id, name, type) VALUES (%s, %s, %s, %s)",
            (plant, meter_id, name, m_type),
        )

    conn.commit()
    conn.close()
    return {"success": True}


@router.delete("/api/meter_config/{config_id}")
def delete_meter_config(config_id: int, request: Request):
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM meter_config WHERE id=%s", (config_id,))
    conn.commit()
    conn.close()
    return {"success": True}


# ── Device configs (device_id → plant mapping) ─────────────────────────────────

@router.get("/api/device_configs")
def list_device_configs(request: Request):
    """Return all registered device_id → plant mappings."""
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT device_id, plant, label FROM device_configs ORDER BY device_id")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/api/device_configs")
async def register_device_config(request: Request):
    """Register or update a device_id → plant mapping."""
    require_login(request)
    data = await request.json()
    device_id = (data.get("device_id") or "").strip()
    plant     = (data.get("plant") or "").strip()
    label     = (data.get("label") or "").strip()

    if not device_id or not plant:
        raise HTTPException(status_code=400, detail="device_id and plant are required")

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM plants WHERE name=%s", (plant,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail=f"Plant '{plant}' does not exist. Create it first.")

    cur.execute(
        """
        INSERT INTO device_configs (device_id, plant, label)
        VALUES (%s, %s, %s)
        ON CONFLICT (device_id) DO UPDATE SET
            plant = EXCLUDED.plant,
            label = EXCLUDED.label
        """,
        (device_id, plant, label)
    )
    cur.execute(
        "UPDATE device_heartbeats SET is_configured=TRUE WHERE device_id=%s",
        (device_id,)
    )
    conn.commit()
    conn.close()
    return {"success": True}


@router.delete("/api/device_configs/{device_id}")
def unregister_device_config(device_id: str, request: Request):
    """Remove a device_id → plant mapping."""
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM device_configs WHERE device_id=%s", (device_id,))
    cur.execute(
        "UPDATE device_heartbeats SET is_configured=FALSE WHERE device_id=%s",
        (device_id,)
    )
    conn.commit()
    conn.close()
    return {"success": True}


# ── Device heartbeats ──────────────────────────────────────────────────────────


@router.get("/api/device_heartbeats")
def device_heartbeats(request: Request):
    """
    Return all devices that have ever sent a UDP packet.
    Includes online/offline status, meter count, last-seen time,
    and whether the device has been configured (plant exists).

    Frontend uses this to show a live "Discovered Devices" panel —
    even for devices that haven't been configured yet.

    A device is considered ONLINE if last_seen is within 5 minutes.
    """
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            dh.device_id,
            dh.last_seen,
            dh.ip_addr,
            dh.meter_count,
            dh.meter_ids,
            dh.is_configured,
            dc.plant,
            EXTRACT(EPOCH FROM (NOW() - dh.last_seen)) AS seconds_ago
        FROM device_heartbeats dh
        LEFT JOIN device_configs dc ON dh.device_id = dc.device_id
        ORDER BY dh.last_seen DESC
    """)
    rows = cur.fetchall()
    conn.close()

    ONLINE_THRESHOLD = 130  # ~2 minutes (allows 1 dropped packet max)

    result = []
    for row in rows:
        seconds_ago = float(row["seconds_ago"] or 9999)
        result.append({
            "device_id":     row["device_id"],
            "last_seen":     row["last_seen"].strftime("%Y-%m-%d %H:%M:%S") if row["last_seen"] else None,
            "seconds_ago":   round(seconds_ago),
            "ip_addr":       row["ip_addr"],
            "meter_count":   row["meter_count"],
            "meter_ids":     row["meter_ids"].split(",") if row["meter_ids"] else [],
            "is_configured": row["is_configured"],
            "plant":         row["plant"],
            "online":        seconds_ago <= ONLINE_THRESHOLD,
        })
    return result


# ── Export config ──────────────────────────────────────────────────────────────

@router.get("/api/export_config")
def export_config(request: Request):
    """
    Download the current plants + meter config as a JSON file.
    The format matches meter_map.json so it can be re-imported later.

    Output shape:
        {
            "PlantName": {
                "1": {"name": "Meter Name", "type": "incomer"},
                "2": {"name": "Sub Meter",  "type": "submeter"}
            },
            ...
        }
    """
    require_login(request)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT plant, meter_id, name, type FROM meter_config ORDER BY plant, meter_id"
    )
    rows = cur.fetchall()
    conn.close()

    config: dict = {}
    for row in rows:
        plant     = row["plant"]
        meter_id  = str(row["meter_id"])
        if plant not in config:
            config[plant] = {}
        config[plant][meter_id] = {
            "name": row["name"],
            "type": row["type"],
        }

    json_bytes = json.dumps(config, indent=2, ensure_ascii=False).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="ems_config.json"'},
    )


# ── Import config ──────────────────────────────────────────────────────────────

@router.post("/api/import_config")
async def import_config(request: Request):
    """
    Bulk-upsert plants and meter configs from a JSON body.
    Accepts the same format as meter_map.json / export_config output:
        {
            "PlantName": {
                "1": {"name": "Meter Name", "type": "incomer"},
                ...
            }
        }
    Returns a summary of how many plants and meters were created/updated.
    """
    require_login(request)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object at the top level")

    conn = get_db_connection()
    cur = conn.cursor()

    plants_added   = 0
    meters_upserted = 0
    errors         = []

    try:
        for plant, meters in data.items():
            if not isinstance(plant, str) or not plant.strip():
                errors.append(f"Skipped invalid plant key: {plant!r}")
                continue
            plant = plant.strip()

            # Ensure the plant exists
            cur.execute(
                "INSERT INTO plants (name) VALUES (%s) ON CONFLICT DO NOTHING",
                (plant,)
            )
            if cur.rowcount:
                plants_added += 1

            if not isinstance(meters, dict):
                errors.append(f"Skipped plant '{plant}': meters must be an object")
                continue

            for meter_id_str, info in meters.items():
                try:
                    meter_id = int(meter_id_str)
                except ValueError:
                    errors.append(f"Skipped meter '{meter_id_str}' in '{plant}': ID must be an integer")
                    continue

                name   = (info.get("name") or "").strip() if isinstance(info, dict) else ""
                m_type = (info.get("type") or "submeter").strip() if isinstance(info, dict) else "submeter"

                if not name:
                    errors.append(f"Skipped meter {meter_id} in '{plant}': name is required")
                    continue

                if m_type not in ("incomer", "submeter"):
                    m_type = "submeter"

                # Upsert: update if exists, insert if not
                cur.execute(
                    "SELECT id FROM meter_config WHERE plant=%s AND meter_id=%s",
                    (plant, meter_id)
                )
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        "UPDATE meter_config SET name=%s, type=%s WHERE id=%s",
                        (name, m_type, existing[0])
                    )
                else:
                    cur.execute(
                        "INSERT INTO meter_config (plant, meter_id, name, type) VALUES (%s,%s,%s,%s)",
                        (plant, meter_id, name, m_type)
                    )
                meters_upserted += 1

        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))

    conn.close()
    return {
        "success":        True,
        "plants_added":   plants_added,
        "meters_upserted": meters_upserted,
        "errors":         errors,
    }
