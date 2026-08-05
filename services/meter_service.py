from datetime import datetime
from database import get_db_connection
from helpers import get_meter_config, get_incomer_meter_id_for_plant

def upsert_heartbeat(device_id: str, ip_addr: str, meters: list):
    """Update the device_heartbeats row for this device_id (INSERT or UPDATE)."""
    responding = [str(m.get("id")) for m in meters if m.get("status") == "OK"]
    meter_ids_str = ",".join(responding)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT 1 FROM device_configs WHERE device_id=%s", (device_id,))
    is_configured = cur.fetchone() is not None

    cur.execute(
        """
        INSERT INTO device_heartbeats (device_id, last_seen, ip_addr, meter_count, meter_ids, is_configured)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (device_id) DO UPDATE SET
            last_seen     = EXCLUDED.last_seen,
            ip_addr       = EXCLUDED.ip_addr,
            meter_count   = EXCLUDED.meter_count,
            meter_ids     = EXCLUDED.meter_ids,
            is_configured = EXCLUDED.is_configured
        """,
        (device_id, now, ip_addr, len(responding), meter_ids_str, is_configured)
    )
    conn.commit()
    conn.close()


def process_reading(payload: dict, ip_addr: str):
    """Process a single UDP JSON payload."""
    raw_device_id = payload.get("device", "Unknown")
    meters_list = payload.get("meters", [])
    
    # Always log heartbeat first
    upsert_heartbeat(raw_device_id, ip_addr, meters_list)
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT plant FROM device_configs WHERE device_id=%s", (raw_device_id,))
    row = cur.fetchone()
    plant = row[0] if row else None
    
    if plant is None:
        conn.close()
        return False  # Device not configured, heartbeat saved, but no data to store
        
    for meter in meters_list:
        meter_id = str(meter.get("id"))
        config = get_meter_config(plant, meter_id)
        meter_name = config.get("name", f"Meter {meter_id}")
        meter_type = config.get("type", "submeter")

        configured_incomer_id = get_incomer_meter_id_for_plant(plant)
        is_incomer = (configured_incomer_id is not None and meter_id == configured_incomer_id)

        if not is_incomer:
            meter_type = "submeter"

        row_ts = payload.get("timestamp") or meter.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if is_incomer:
            cur.execute(
                """
                INSERT INTO meter_data (
                    plant, meter_id, meter_name, meter_type, status,
                    freq, volt, curr, pf, kw, kva, kwh,
                    line_voltage, line_to_line_voltage, avg_voltage, voltage_unbalance,
                    line_current, current_l1, current_l2, current_l3, avg_current,
                    neutral_line_current, kw_l1, kw_l2, kw_l3, kw_total,
                    kva_l1, kva_l2, kva_l3, kva_total, kva_max_demand,
                    timestamp
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    plant, meter.get("id"), meter_name, meter_type, meter.get("status"),
                    meter.get("freq"), meter.get("volt"), meter.get("curr"), meter.get("pf"),
                    meter.get("kw"), meter.get("kva"), meter.get("kwh"),
                    meter.get("line_voltage"), meter.get("line_to_line_voltage"),
                    meter.get("avg_voltage"), meter.get("voltage_unbalance"),
                    meter.get("line_current"), meter.get("current_l1"),
                    meter.get("current_l2"), meter.get("current_l3"), meter.get("avg_current"),
                    meter.get("neutral_line_current"),
                    meter.get("kw_l1"), meter.get("kw_l2"), meter.get("kw_l3"), meter.get("kw_total"),
                    meter.get("kva_l1"), meter.get("kva_l2"), meter.get("kva_l3"),
                    meter.get("kva_total"), meter.get("kva_max_demand"),
                    row_ts,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO meter_data (plant, meter_id, meter_name, meter_type, status, kwh, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (plant, meter.get("id"), meter_name, meter_type, meter.get("status"), meter.get("kwh"), row_ts),
            )

    conn.commit()
    conn.close()
    return True


import psycopg2.extras
from helpers import get_all_meters, compute_live_status


def _normalize_meter_param(meter):
    """Treat missing/invalid meter as 'all' for plant-wide latest rows."""
    if meter is None:
        return "all"
    s = str(meter).strip()
    if not s or s.lower() in ("none", "null", "undefined", "all"):
        return "all"
    return s


def fetch_latest_rows(plant, meter, conn=None):
    """
    Return the most-recent meter_data row(s) for the given plant/meter.
    Pass an open connection to reuse it (e.g. inside a long-lived SSE stream).
  When meter is omitted, returns latest row for every meter in the plant.
    """
    if not plant:
        return []

    meter = _normalize_meter_param(meter)

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
    try:
        meter_id = int(meter)
    except (ValueError, TypeError):
        if own_conn:
            conn.close()
        return []

    query = "SELECT * FROM meter_data WHERE plant=%s AND meter_id=%s ORDER BY timestamp DESC LIMIT 1"
    cur.execute(query, (str(plant), meter_id))
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

