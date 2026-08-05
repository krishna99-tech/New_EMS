import psycopg2
import psycopg2.extras
from fastapi import HTTPException
from database import get_db_connection

def get_all_device_configs():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT device_id, plant, label FROM device_configs ORDER BY device_id")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def register_device(device_id: str, plant: str, label: str):
    if not device_id or not plant:
        raise HTTPException(status_code=400, detail="device_id and plant are required")

    conn = get_db_connection()
    cur = conn.cursor()
    
    # Verify plant exists
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

def unregister_device(device_id: str):
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

def get_all_device_heartbeats():
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

