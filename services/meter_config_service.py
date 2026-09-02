import psycopg2
import psycopg2.extras
from fastapi import HTTPException
from database import get_db_connection

def get_all_meter_configs():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, plant, meter_id, name, type FROM meter_config ORDER BY plant, meter_id")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_meter_config(config_id: int, plant: str, meter_id: int, name: str, m_type: str = "submeter"):
    if not plant or not meter_id or not name:
        raise HTTPException(status_code=400, detail="Missing fields")

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

    if config_id:
        cur.execute("SELECT id FROM meter_config WHERE id=%s", (config_id,))
        existing = cur.fetchone()
    else:
        cur.execute("SELECT id FROM meter_config WHERE plant=%s AND meter_id=%s", (plant, meter_id))
        existing = cur.fetchone()

    if existing:
        cur.execute(
            "UPDATE meter_config SET plant=%s, meter_id=%s, name=%s, type=%s WHERE id=%s",
            (plant, meter_id, name, m_type, existing[0]),
        )
    else:
        cur.execute(
            "INSERT INTO meter_config (plant, meter_id, name, type) VALUES (%s, %s, %s, %s)",
            (plant, meter_id, name, m_type),
        )

    conn.commit()
    conn.close()
    return {"success": True}

def delete_meter_config(config_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM meter_config WHERE id=%s", (config_id,))
    conn.commit()
    conn.close()
    return {"success": True}

def export_config_data():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT plant, meter_id, name, type FROM meter_config ORDER BY plant, meter_id")
    rows = cur.fetchall()
    conn.close()

    config = {}
    for row in rows:
        plant = row["plant"]
        meter_id = str(row["meter_id"])
        if plant not in config:
            config[plant] = {}
        config[plant][meter_id] = {
            "name": row["name"],
            "type": row["type"],
        }
    return config

def import_config_data(data: dict):
    conn = get_db_connection()
    cur = conn.cursor()

    plants_added = 0
    meters_upserted = 0
    errors = []

    try:
        for plant, meters in data.items():
            if not isinstance(plant, str) or not plant.strip():
                errors.append(f"Skipped invalid plant key: {plant!r}")
                continue
            plant = plant.strip()

            cur.execute("INSERT INTO plants (name) VALUES (%s) ON CONFLICT DO NOTHING", (plant,))
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

                name = (info.get("name") or "").strip() if isinstance(info, dict) else ""
                m_type = (info.get("type") or "submeter").strip() if isinstance(info, dict) else "submeter"

                if not name:
                    errors.append(f"Skipped meter {meter_id} in '{plant}': name is required")
                    continue

                if m_type not in ("incomer", "submeter"):
                    m_type = "submeter"

                cur.execute("SELECT id FROM meter_config WHERE plant=%s AND meter_id=%s", (plant, meter_id))
                existing = cur.fetchone()
                if existing:
                    cur.execute("UPDATE meter_config SET name=%s, type=%s WHERE id=%s", (name, m_type, existing[0]))
                else:
                    cur.execute("INSERT INTO meter_config (plant, meter_id, name, type) VALUES (%s,%s,%s,%s)", (plant, meter_id, name, m_type))
                meters_upserted += 1

        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))

    conn.close()
    return {
        "success": True,
        "plants_added": plants_added,
        "meters_upserted": meters_upserted,
        "errors": errors,
    }

