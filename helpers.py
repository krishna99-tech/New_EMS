"""
helpers.py — reusable business-logic helpers shared across routers.

Covers:
  • Meter / plant config lookups
  • Live-status computation
  • Shift window utilities
  • Low-level DB fetch helpers (pass in an open cursor)
"""

from datetime import datetime, timedelta

import psycopg2.extras

from config import OFFLINE_THRESHOLD_SECONDS
from database import get_db_connection


# ══════════════════════════════════════════════════════════════════════════════
# Meter / plant config
# ══════════════════════════════════════════════════════════════════════════════

def get_incomer_meter_id_for_plant(plant: str):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT meter_id FROM meter_config WHERE plant=%s AND type='incomer' LIMIT 1",
        (plant,)
    )
    row = cur.fetchone()
    conn.close()
    return str(row[0]) if row else None


def get_all_meters(plant: str) -> dict:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT meter_id, name, type FROM meter_config WHERE plant=%s", (plant,))
    rows = cur.fetchall()
    conn.close()
    return {str(row[0]): {"name": row[1], "type": row[2]} for row in rows}


def get_all_plants() -> list:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT name FROM plants ORDER BY name ASC")
    rows = cur.fetchall()
    conn.close()
    return [row[0] for row in rows]


def get_meter_config(plant: str, meter_id) -> dict:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT name, type FROM meter_config WHERE plant=%s AND meter_id=%s",
        (plant, meter_id)
    )
    row = cur.fetchone()
    conn.close()
    return {"name": row[0], "type": row[1]} if row else {}


# ══════════════════════════════════════════════════════════════════════════════
# Live-status
# ══════════════════════════════════════════════════════════════════════════════

def compute_live_status(row: dict) -> str:
    ts_str = row.get("timestamp")
    if not ts_str:
        return "Offline"
    try:
        ts = ts_str if isinstance(ts_str, datetime) else datetime.strptime(str(ts_str), "%Y-%m-%d %H:%M:%S")
        age = (datetime.now() - ts).total_seconds()
        return "OK" if age <= OFFLINE_THRESHOLD_SECONDS else "Offline"
    except Exception:
        return "Offline"


# ══════════════════════════════════════════════════════════════════════════════
# Shift window utilities
# ══════════════════════════════════════════════════════════════════════════════

def get_shift_name(dt: datetime) -> str:
    hour = dt.hour
    if 6 <= hour < 14:
        return "Shift A (06:00-14:00)"
    if 14 <= hour < 22:
        return "Shift B (14:00-22:00)"
    return "Shift C (22:00-06:00)"


def get_shift_start(dt: datetime) -> datetime:
    day = dt.date()
    hour = dt.hour
    if 6 <= hour < 14:
        return datetime.combine(day, datetime.min.time()).replace(hour=6)
    if 14 <= hour < 22:
        return datetime.combine(day, datetime.min.time()).replace(hour=14)
    if hour >= 22:
        return datetime.combine(day, datetime.min.time()).replace(hour=22)
    return datetime.combine(day - timedelta(days=1), datetime.min.time()).replace(hour=22)


def get_shift_windows(start_dt: datetime, end_dt: datetime) -> list:
    windows = []
    cursor = get_shift_start(start_dt)
    while cursor < end_dt:
        next_cursor = cursor + timedelta(hours=8)
        if next_cursor > start_dt and cursor < end_dt:
            windows.append((cursor, next_cursor, get_shift_name(cursor)))
        cursor = next_cursor
    return windows


def get_production_day_key(dt: datetime) -> str:
    production_day = dt.date() if dt.hour >= 6 else (dt.date() - timedelta(days=1))
    return production_day.strftime("%Y-%m-%d")


# ══════════════════════════════════════════════════════════════════════════════
# Low-level DB fetch helpers  (accept an open psycopg2 cursor)
# ══════════════════════════════════════════════════════════════════════════════

def fetch_latest_kwh_at_or_before(cur, plant, meter_id, dt: datetime):
    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp <= %s
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (plant, meter_id, dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    return cur.fetchone()


def fetch_latest_value_at_or_before(cur, plant, meter_id, dt: datetime, column: str):
    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp <= %s AND {column} IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (plant, meter_id, dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    return cur.fetchone()


def fetch_kwh_bounds_in_window(cur, plant, meter_id, start_dt: datetime, end_dt: datetime):
    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp >= %s AND timestamp <= %s
        ORDER BY timestamp ASC
        LIMIT 1
        """,
        (plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    first_row = cur.fetchone()

    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp >= %s AND timestamp <= %s
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    last_row = cur.fetchone()
    return first_row, last_row


def fetch_value_bounds_in_window(cur, plant, meter_id, start_dt: datetime, end_dt: datetime, column: str):
    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp >= %s AND timestamp <= %s AND {column} IS NOT NULL
        ORDER BY timestamp ASC
        LIMIT 1
        """,
        (plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    first_row = cur.fetchone()

    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp >= %s AND timestamp <= %s AND {column} IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    last_row = cur.fetchone()
    return first_row, last_row


def fetch_avg_value_in_window(cur, plant, meter_id, start_dt: datetime, end_dt: datetime, column: str):
    cur.execute(
        f"""
        SELECT AVG({column}) AS avg_val
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp >= %s AND timestamp <= %s AND {column} IS NOT NULL
        """,
        (plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S"))
    )
    return cur.fetchone()
