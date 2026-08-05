from datetime import datetime

import psycopg2.extras

from config import OFFLINE_THRESHOLD_SECONDS
from database import get_db_connection
from helpers import get_all_plants
from services import group_service


def get_system_overview():
    plants = get_all_plants()
    groups = group_service.get_all_groups()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT COUNT(*) AS cnt FROM meter_config")
    meter_count = cur.fetchone()["cnt"]

    cur.execute(
        """
        SELECT COUNT(*) AS cnt FROM (
            SELECT DISTINCT ON (plant, meter_id) plant, meter_id, timestamp
            FROM meter_data
            ORDER BY plant, meter_id, timestamp DESC
        ) latest
        WHERE latest.timestamp >= NOW() - (%s || ' seconds')::interval
        """,
        (OFFLINE_THRESHOLD_SECONDS,),
    )
    online_count = cur.fetchone()["cnt"]

    cur.execute(
        """
        SELECT MAX(timestamp) AS last_reading
        FROM meter_data
        """
    )
    last_row = cur.fetchone()
    last_reading = last_row["last_reading"] if last_row else None
    if isinstance(last_reading, datetime):
        last_reading = last_reading.strftime("%Y-%m-%d %H:%M:%S")

    conn.close()

    member_total = sum(len(g.get("members") or []) for g in groups)

    return {
        "plant_count": len(plants),
        "group_count": len(groups),
        "meter_count": meter_count,
        "online_meter_count": online_count,
        "group_member_count": member_total,
        "last_reading": last_reading,
        "production_day_note": "Production day: 06:00 → 06:00",
    }
