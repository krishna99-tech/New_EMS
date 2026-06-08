from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import socket
import threading
import sqlite3
import json
import csv
import io
import os
from datetime import datetime, timedelta
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "static"),
    template_folder=os.path.join(BASE_DIR, "templates")
)

DB_PATH = os.path.join(BASE_DIR, "meters.db")

# ================= DATABASE =================


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

def init_db():

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS meter_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant TEXT,
        meter_id INTEGER,
        meter_name TEXT,
        meter_type TEXT,
        status TEXT,
        freq REAL,
        volt REAL,
        curr REAL,
        pf REAL,
        kw REAL,
        kva REAL,
        kwh REAL,
        line_voltage REAL,
        line_to_line_voltage REAL,
        avg_voltage REAL,
        voltage_unbalance REAL,
        line_current REAL,
        current_l1 REAL,
        current_l2 REAL,
        current_l3 REAL,
        avg_current REAL,
        neutral_line_current REAL,
        kw_l1 REAL,
        kw_l2 REAL,
        kw_l3 REAL,
        kw_total REAL,
        kva_l1 REAL,
        kva_l2 REAL,
        kva_l3 REAL,
        kva_total REAL,
        kva_max_demand REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Backward-compatible migration for existing databases.
    cur.execute("PRAGMA table_info(meter_data)")
    existing_columns = {row[1] for row in cur.fetchall()}
    required_columns = [
        ("line_voltage", "REAL"),
        ("line_to_line_voltage", "REAL"),
        ("avg_voltage", "REAL"),
        ("voltage_unbalance", "REAL"),
        ("line_current", "REAL"),
        ("current_l1", "REAL"),
        ("current_l2", "REAL"),
        ("current_l3", "REAL"),
        ("avg_current", "REAL"),
        ("neutral_line_current", "REAL"),
        ("kw_l1", "REAL"),
        ("kw_l2", "REAL"),
        ("kw_l3", "REAL"),
        ("kw_total", "REAL"),
        ("kva_l1", "REAL"),
        ("kva_l2", "REAL"),
        ("kva_l3", "REAL"),
        ("kva_total", "REAL"),
        ("kva_max_demand", "REAL"),
    ]
    for col_name, col_type in required_columns:
        if col_name not in existing_columns:
            cur.execute(f"ALTER TABLE meter_data ADD COLUMN {col_name} {col_type}")

    # Query-performance indexes for time-series lookups used by dashboard/CSV.
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_meter_data_plant_meter_ts
        ON meter_data (plant, meter_id, timestamp)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_meter_data_plant_ts
        ON meter_data (plant, timestamp)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_meter_data_ts
        ON meter_data (timestamp)
        """
    )

    conn.commit()
    conn.close()

init_db()

# ================= LOAD JSON =================

with open(os.path.join(BASE_DIR, "meter_map.json"), "r") as f:
    meter_map = json.load(f)


def get_incomer_meter_id_for_plant(plant):
    meters = meter_map.get(plant, {})
    incomers = [mid for mid, meta in meters.items() if meta.get("type") == "incomer"]
    if not incomers:
        return None
    # Business rule: one incomer per plant.
    return str(incomers[0])


def normalize_historical_data():
    conn = get_db_connection()
    cur = conn.cursor()

    submeter_null_cols = [
        "freq",
        "volt",
        "curr",
        "pf",
        "kw",
        "kva",
        "line_voltage",
        "line_to_line_voltage",
        "avg_voltage",
        "voltage_unbalance",
        "line_current",
        "current_l1",
        "current_l2",
        "current_l3",
        "avg_current",
        "neutral_line_current",
        "kw_l1",
        "kw_l2",
        "kw_l3",
        "kw_total",
        "kva_l1",
        "kva_l2",
        "kva_l3",
        "kva_total",
        "kva_max_demand",
    ]
    null_assignments = ", ".join([f"{col}=NULL" for col in submeter_null_cols])

    for plant, meters in meter_map.items():
        for meter_id, meta in meters.items():
            meter_name = meta.get("name", f"Meter {meter_id}")
            meter_type = meta.get("type", "submeter")

            # Keep historical rows aligned with current meter map identity.
            cur.execute(
                """
                UPDATE meter_data
                SET meter_name=?, meter_type=?
                WHERE plant=? AND meter_id=?
                """,
                [meter_name, meter_type, plant, int(meter_id)]
            )

            # One-time cleanup for legacy rows:
            # keep only kWh for submeters.
            if meter_type != "incomer":
                cur.execute(
                    f"""
                    UPDATE meter_data
                    SET {null_assignments}
                    WHERE plant=? AND meter_id=?
                    """,
                    [plant, int(meter_id)]
                )

    conn.commit()
    conn.close()


normalize_historical_data()

# ================= UDP SERVER =================

UDP_IP = "0.0.0.0"
UDP_PORT = 10011

def udp_server():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((UDP_IP, UDP_PORT))
    except OSError as e:
        print(f"UDP bind failed on {UDP_IP}:{UDP_PORT}: {e}")
        print("Tip: another process (or duplicate Flask debug process) is already using this port.")
        return

    print(f"UDP Server Listening on {UDP_PORT}")

    while True:
        data, addr = sock.recvfrom(4096)
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            decoded = data.decode()
            print("Received:", decoded)

            payload = json.loads(decoded)

            plant = payload.get("device", "Unknown")

            for meter in payload["meters"]:
                meter_id = str(meter.get("id"))

                config = meter_map.get(plant, {}).get(meter_id, {})

                meter_name = config.get("name", f"Meter {meter_id}")
                meter_type = config.get("type", "submeter")
                configured_incomer_id = get_incomer_meter_id_for_plant(plant)
                is_incomer = configured_incomer_id is not None and meter_id == configured_incomer_id
                # Enforce strict persistence rule even if metadata/payload is inconsistent.
                if not is_incomer:
                    meter_type = "submeter"

                row_ts = meter.get("timestamp") or payload.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if is_incomer:
                    # Incomer: store full electrical parameter set.
                    cur.execute("""
                    INSERT INTO meter_data (
                        plant, meter_id, meter_name, meter_type, status,
                        freq, volt, curr, pf, kw, kva, kwh,
                        line_voltage, line_to_line_voltage, avg_voltage, voltage_unbalance,
                        line_current, current_l1, current_l2, current_l3, avg_current,
                        neutral_line_current, kw_l1, kw_l2, kw_l3, kw_total,
                        kva_l1, kva_l2, kva_l3, kva_total, kva_max_demand,
                        timestamp
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        plant,
                        meter.get("id"),
                        meter_name,
                        meter_type,
                        meter.get("status"),
                        meter.get("freq"),
                        meter.get("volt"),
                        meter.get("curr"),
                        meter.get("pf"),
                        meter.get("kw"),
                        meter.get("kva"),
                        meter.get("kwh"),
                        meter.get("line_voltage"),
                        meter.get("line_to_line_voltage"),
                        meter.get("avg_voltage"),
                        meter.get("voltage_unbalance"),
                        meter.get("line_current"),
                        meter.get("current_l1"),
                        meter.get("current_l2"),
                        meter.get("current_l3"),
                        meter.get("avg_current"),
                        meter.get("neutral_line_current"),
                        meter.get("kw_l1"),
                        meter.get("kw_l2"),
                        meter.get("kw_l3"),
                        meter.get("kw_total"),
                        meter.get("kva_l1"),
                        meter.get("kva_l2"),
                        meter.get("kva_l3"),
                        meter.get("kva_total"),
                        meter.get("kva_max_demand"),
                        row_ts
                    ))
                else:
                    # Submeter: store only kWh-focused columns.
                    cur.execute("""
                    INSERT INTO meter_data (
                        plant, meter_id, meter_name, meter_type, status, kwh, timestamp
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        plant,
                        meter.get("id"),
                        meter_name,
                        meter_type,
                        meter.get("status"),
                        meter.get("kwh"),
                        row_ts
                    ))

            conn.commit()
        except Exception as e:
            print("Error:", e)
        finally:
            try:
                conn.close()
            except Exception:
                pass

def start_udp_server_once():
    t = threading.Thread(target=udp_server, daemon=True, name="udp_server")
    t.start()

# ================= ROUTES =================

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/plants")
def plants():

    return jsonify(list(meter_map.keys()))

@app.route("/meters")
def meters():

    plant = request.args.get("plant")

    meters = meter_map.get(plant, {})

    result = []

    for meter_id, data in meters.items():

        result.append({
            "id": meter_id,
            "name": data["name"],
            "type": data.get("type", "submeter")
        })

    return jsonify(result)

@app.route("/latest")
def latest():

    plant = request.args.get("plant")
    meter = request.args.get("meter")

    conn = get_db_connection()
    conn.row_factory = sqlite3.Row

    cur = conn.cursor()

    if meter == "all":
        meters = meter_map.get(str(plant), {})
        rows = []
        for meter_id, meta in meters.items():
            cur.execute(
                "SELECT * FROM meter_data WHERE plant=? AND meter_id=? ORDER BY timestamp DESC LIMIT 1",
                [str(plant), int(meter_id)]
            )
            row = cur.fetchone()
            if not row:
                continue
            normalized = dict(row)
            normalized["meter_name"] = meta.get("name", normalized.get("meter_name"))
            normalized["meter_type"] = meta.get("type", normalized.get("meter_type"))
            rows.append(normalized)
        rows.sort(key=lambda r: (r.get("meter_name") or ""))
        conn.close()
        return jsonify(rows)
    else:
        query = "SELECT * FROM meter_data WHERE plant=? AND meter_id=? ORDER BY timestamp DESC LIMIT 1"
        try:
            # Ensure we are querying with the correct types (string for plant, int for meter_id)
            params = [str(plant), int(meter)]
        except (ValueError, TypeError):
            # Fallback if meter is not a valid number
            params = [str(plant), str(meter)]

    cur.execute(query, params)

    rows = cur.fetchall()

    conn.close()

    return jsonify([dict(r) for r in rows])


def fetch_latest_rows(plant, meter, conn=None):
    own_conn = conn is None
    if own_conn:
        conn = get_db_connection()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if meter == "all":
        meters = meter_map.get(str(plant), {})
        rows = []
        for meter_id, meta in meters.items():
            cur.execute(
                "SELECT * FROM meter_data WHERE plant=? AND meter_id=? ORDER BY timestamp DESC LIMIT 1",
                [str(plant), int(meter_id)]
            )
            row = cur.fetchone()
            if not row:
                continue
            normalized = dict(row)
            normalized["meter_name"] = meta.get("name", normalized.get("meter_name"))
            normalized["meter_type"] = meta.get("type", normalized.get("meter_type"))
            rows.append(normalized)
        rows.sort(key=lambda r: (r.get("meter_name") or ""))
        if own_conn:
            conn.close()
        return rows
    else:
        query = "SELECT * FROM meter_data WHERE plant=? AND meter_id=? ORDER BY timestamp DESC LIMIT 1"
        try:
            params = [str(plant), int(meter)]
        except (ValueError, TypeError):
            params = [str(plant), str(meter)]

    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    if own_conn:
        conn.close()
    return rows


@app.route("/stream_latest")
def stream_latest():
    plant = request.args.get("plant")
    meter = request.args.get("meter")

    if not plant or not meter:
        return jsonify({"error": "plant and meter are required"}), 400

    @stream_with_context
    def generate():
        last_signature = None
        conn = get_db_connection()
        while True:
            try:
                rows = fetch_latest_rows(plant, meter, conn=conn)
                signature = "|".join(f"{r.get('meter_id')}:{r.get('id')}" for r in rows) if rows else "empty"
                if signature != last_signature:
                    payload = {
                        "plant": plant,
                        "meter": meter,
                        "rows": rows,
                        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    }
                    yield f"event: latest\ndata: {json.dumps(payload)}\n\n"
                    last_signature = signature
                else:
                    # Keep-alive event so proxies/browser keep the stream open.
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err_payload = {"message": str(e)[:180]}
                yield f"event: error\ndata: {json.dumps(err_payload)}\n\n"
                try:
                    conn.close()
                except Exception:
                    pass
                conn = get_db_connection()
            time.sleep(2)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


def get_shift_name(dt):
    hour = dt.hour
    if 6 <= hour < 14:
        return "Shift A (06:00-14:00)"
    if 14 <= hour < 22:
        return "Shift B (14:00-22:00)"
    return "Shift C (22:00-06:00)"


def get_shift_start(dt):
    day = dt.date()
    hour = dt.hour
    if 6 <= hour < 14:
        return datetime.combine(day, datetime.min.time()).replace(hour=6)
    if 14 <= hour < 22:
        return datetime.combine(day, datetime.min.time()).replace(hour=14)
    if hour >= 22:
        return datetime.combine(day, datetime.min.time()).replace(hour=22)
    return datetime.combine(day - timedelta(days=1), datetime.min.time()).replace(hour=22)


def get_shift_windows(start_dt, end_dt):
    windows = []
    cursor = get_shift_start(start_dt)
    while cursor < end_dt:
        next_cursor = cursor + timedelta(hours=8)
        if next_cursor > start_dt and cursor < end_dt:
            windows.append((cursor, next_cursor, get_shift_name(cursor)))
        cursor = next_cursor
    return windows


def get_production_day_key(dt):
    # Production day runs from 06:00 to next day 06:00.
    # Any timestamp before 06:00 belongs to previous production day.
    production_day = dt.date() if dt.hour >= 6 else (dt.date() - timedelta(days=1))
    return production_day.strftime("%Y-%m-%d")


def fetch_latest_kwh_at_or_before(cur, plant, meter_id, dt):
    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        [plant, meter_id, dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    return cur.fetchone()


def fetch_latest_value_at_or_before(cur, plant, meter_id, dt, column):
    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp <= ? AND {column} IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        [plant, meter_id, dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    return cur.fetchone()


def fetch_kwh_bounds_in_window(cur, plant, meter_id, start_dt, end_dt):
    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
        LIMIT 1
        """,
        [plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    first_row = cur.fetchone()

    cur.execute(
        """
        SELECT kwh, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        [plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    last_row = cur.fetchone()
    return first_row, last_row


def fetch_value_bounds_in_window(cur, plant, meter_id, start_dt, end_dt, column):
    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp >= ? AND timestamp <= ? AND {column} IS NOT NULL
        ORDER BY timestamp ASC
        LIMIT 1
        """,
        [plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    first_row = cur.fetchone()

    cur.execute(
        f"""
        SELECT {column} AS val, timestamp
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp >= ? AND timestamp <= ? AND {column} IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        [plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    last_row = cur.fetchone()
    return first_row, last_row


def fetch_avg_value_in_window(cur, plant, meter_id, start_dt, end_dt, column):
    cur.execute(
        f"""
        SELECT AVG({column}) AS avg_val
        FROM meter_data
        WHERE plant=? AND meter_id=? AND timestamp >= ? AND timestamp <= ? AND {column} IS NOT NULL
        """,
        [plant, meter_id, start_dt.strftime("%Y-%m-%d %H:%M:%S"), end_dt.strftime("%Y-%m-%d %H:%M:%S")]
    )
    return cur.fetchone()


@app.route("/energy_summary")
def energy_summary():
    plant = request.args.get("plant")
    meter = request.args.get("meter")
    mode = request.args.get("mode", "shiftwise")
    selected_shift = request.args.get("shift", "all")
    from_dt_raw = request.args.get("from_dt")
    to_dt_raw = request.args.get("to_dt")

    if not plant or not meter:
        return jsonify({"error": "plant and meter are required"}), 400

    now = datetime.now()
    if from_dt_raw and to_dt_raw:
        try:
            from_dt = datetime.fromisoformat(from_dt_raw)
            to_dt = datetime.fromisoformat(to_dt_raw)
        except ValueError:
            return jsonify({"error": "Invalid datetime format"}), 400
    else:
        today_6am = datetime.combine(now.date(), datetime.min.time()).replace(hour=6)
        if now < today_6am:
            today_6am -= timedelta(days=1)
        from_dt = today_6am - timedelta(days=1)
        to_dt = today_6am

    if to_dt <= from_dt:
        return jsonify({"error": "to_dt must be greater than from_dt"}), 400

    conn = get_db_connection()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    meters = meter_map.get(plant, {})
    meter_config = meters.get(str(meter), {})
    if not meter_config:
        conn.close()
        return jsonify({"error": "Meter not found"}), 404

    meter_type = meter_config.get("type", "submeter")
    value_column = "kwh"
    unit = "kWh"
    metric_name = "Energy Consumption"

    start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), from_dt, value_column)
    end_row = fetch_latest_value_at_or_before(cur, plant, int(meter), to_dt, value_column)

    start_kwh = start_row["val"] if start_row else None
    end_kwh = end_row["val"] if end_row else None
    total_consumption = None
    if start_kwh is not None and end_kwh is not None:
        total_consumption = round(max(0, end_kwh - start_kwh), 2)

    shift_start = get_shift_start(now)
    shift_end = shift_start + timedelta(hours=8)
    shift_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), shift_start, value_column)
    shift_now_row = fetch_latest_value_at_or_before(cur, plant, int(meter), now, value_column)

    current_shift_start_kwh = shift_start_row["val"] if shift_start_row else None
    current_shift_end_kwh = shift_now_row["val"] if shift_now_row else None
    current_shift_consumption = None
    if current_shift_start_kwh is not None and current_shift_end_kwh is not None:
        current_shift_consumption = round(max(0, current_shift_end_kwh - current_shift_start_kwh), 2)

    bars = []
    if mode == "totalshifts":
        windows = get_shift_windows(from_dt, to_dt)
        for idx, (window_start, window_end, shift_name) in enumerate(windows, start=1):
            w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, value_column)
            if not w_start_row or not w_end_row:
                continue
            cons = round(max(0, w_end_row["val"] - w_start_row["val"]), 2)
            bars.append({
                "label": f"Shift {idx}",
                "shift_name": shift_name,
                "start": window_start.strftime("%Y-%m-%d %H:%M:%S"),
                "end": window_end.strftime("%Y-%m-%d %H:%M:%S"),
                "start_kwh": round(w_start_row["val"], 2),
                "end_kwh": round(w_end_row["val"], 2),
                "consumption": cons
            })
    else:
        windows = get_shift_windows(from_dt, to_dt)
        if selected_shift != "all":
            day_buckets = {}
            for window_start, window_end, shift_name in windows:
                if not shift_name.startswith(selected_shift):
                    continue
                w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, value_column)
                if not w_start_row or not w_end_row:
                    continue
                cons = round(max(0, w_end_row["val"] - w_start_row["val"]), 2)
                day_key = get_production_day_key(window_start)
                day_buckets[day_key] = day_buckets.get(day_key, 0) + cons
            for day_key in sorted(day_buckets.keys()):
                bars.append({
                    "label": day_key,
                    "shift_name": selected_shift,
                    "start": f"{day_key} 06:00:00",
                    "end": (datetime.strptime(day_key, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d 06:00:00"),
                    "start_kwh": None,
                    "end_kwh": None,
                    "consumption": round(day_buckets[day_key], 2)
                })
        else:
            # All Shifts => full-day total per date (sum of A+B+C for each day)
            day_buckets = {}
            for window_start, window_end, _shift_name in windows:
                w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, value_column)
                if not w_start_row or not w_end_row:
                    continue
                cons = round(max(0, w_end_row["val"] - w_start_row["val"]), 2)
                day_key = get_production_day_key(window_start)
                day_buckets[day_key] = day_buckets.get(day_key, 0) + cons

            for day_key in sorted(day_buckets.keys()):
                bars.append({
                    "label": day_key,
                    "shift_name": "All Shifts",
                    "start": f"{day_key} 06:00:00",
                    "end": (datetime.strptime(day_key, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d 06:00:00"),
                    "start_kwh": None,
                    "end_kwh": None,
                    "consumption": round(day_buckets[day_key], 2)
                })

    selected_total_kwh = round(sum((b.get("consumption") or 0) for b in bars), 2)
    # Shift-filtered card values:
    # Use in-window bounds so dashboard cards match CSV shift windows.
    selected_start_kwh = None
    selected_end_kwh = None
    selected_windows = get_shift_windows(from_dt, to_dt)
    if selected_shift != "all":
        selected_windows = [w for w in selected_windows if w[2].startswith(selected_shift)]

    first_start_row = None
    last_end_row = None
    valid_window_count = 0
    for window_start, window_end, _ in selected_windows:
        w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, value_column)
        if not w_start_row or not w_end_row:
            continue
        valid_window_count += 1
        if first_start_row is None:
            first_start_row = w_start_row
        last_end_row = w_end_row

    if first_start_row and last_end_row:
        selected_start_kwh = first_start_row["val"]
        selected_end_kwh = last_end_row["val"]
    else:
        # For specific shifts, do not backfill from range boundaries.
        # This avoids showing misleading end values when selected shift has no data.
        if selected_shift == "all":
            selected_start_kwh = start_kwh
            selected_end_kwh = end_kwh
        else:
            selected_start_kwh = None
            selected_end_kwh = None

    response = jsonify({
        "meter_id": meter,
        "meter_name": meter_config.get("name"),
        "meter_type": meter_type,
        "value_unit": unit,
        "metric_name": metric_name,
        "mode": mode,
        "selected_shift": selected_shift,
        "from_dt": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "yesterday_total_kwh": total_consumption,
        "range_start_kwh": selected_start_kwh,
        "range_end_kwh": selected_end_kwh,
        "current_shift_name": get_shift_name(now),
        "current_shift_start": shift_start.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_end": shift_end.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_start_kwh": current_shift_start_kwh,
        "current_shift_end_kwh": current_shift_end_kwh,
        "current_shift_consumption_kwh": current_shift_consumption,
        "selected_total_kwh": selected_total_kwh,
        "has_shift_window_data": valid_window_count > 0,
        "bars": bars
    })
    conn.close()
    return response


@app.route("/incomer_shift_summary")
def incomer_shift_summary():
    plant = request.args.get("plant")
    meter = request.args.get("meter")
    selected_shift = request.args.get("shift", "all")
    from_dt_raw = request.args.get("from_dt")
    to_dt_raw = request.args.get("to_dt")

    if not plant or not meter or not from_dt_raw or not to_dt_raw:
        return jsonify({"error": "plant, meter, from_dt and to_dt are required"}), 400

    try:
        from_dt = datetime.fromisoformat(from_dt_raw)
        to_dt = datetime.fromisoformat(to_dt_raw)
    except ValueError:
        return jsonify({"error": "Invalid datetime format"}), 400

    if to_dt <= from_dt:
        return jsonify({"error": "to_dt must be greater than from_dt"}), 400

    meters = meter_map.get(plant, {})
    meter_config = meters.get(str(meter), {})
    if not meter_config:
        return jsonify({"error": "Meter not found"}), 404
    if meter_config.get("type") != "incomer":
        return jsonify({"error": "This endpoint is only for incomer meters"}), 400

    conn = get_db_connection()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    parameter_defs = [
        ("Line Voltage", "line_voltage", "V"),
        ("Line-to-Line Voltage", "line_to_line_voltage", "V"),
        ("Average Voltage", "avg_voltage", "V"),
        ("Voltage Unbalance", "voltage_unbalance", "%"),
        ("Line Current", "line_current", "A"),
        ("Phase-wise Current L1", "current_l1", "A"),
        ("Phase-wise Current L2", "current_l2", "A"),
        ("Phase-wise Current L3", "current_l3", "A"),
        ("Average Current", "avg_current", "A"),
        ("Neutral Line Current", "neutral_line_current", "A"),
        ("Active Power kW L1", "kw_l1", "kW"),
        ("Active Power kW L2", "kw_l2", "kW"),
        ("Active Power kW L3", "kw_l3", "kW"),
        ("Cumulative kW", "kw_total", "kW"),
        ("Apparent Power kVA L1", "kva_l1", "kVA"),
        ("Apparent Power kVA L2", "kva_l2", "kVA"),
        ("Apparent Power kVA L3", "kva_l3", "kVA"),
        ("Cumulative kVA", "kva_total", "kVA"),
        ("Power Factor", "pf", ""),
        ("Frequency", "freq", "Hz"),
        ("kVA Maximum Demand", "kva_max_demand", "kVA"),
    ]

    windows = get_shift_windows(from_dt, to_dt)
    if selected_shift != "all":
        windows = [w for w in windows if w[2].startswith(selected_shift)]

    series = []
    # Add kWh consumption shift series for incomer as well.
    kwh_day_buckets = {}
    for window_start, window_end, _shift_name in windows:
        w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, "kwh")
        if not w_start_row or not w_end_row:
            continue
        cons = round(max(0, w_end_row["val"] - w_start_row["val"]), 2)
        day_key = get_production_day_key(window_start)
        kwh_day_buckets[day_key] = kwh_day_buckets.get(day_key, 0) + cons

    kwh_bars = []
    for day_key in sorted(kwh_day_buckets.keys()):
        kwh_bars.append({
            "label": day_key,
            "value": round(kwh_day_buckets[day_key], 2)
        })
    if kwh_bars:
        series.append({
            "label": "Energy Consumption",
            "unit": "kWh",
            "bars": kwh_bars
        })

    for label, column, unit in parameter_defs:
        day_buckets = {}
        day_counts = {}
        for window_start, window_end, _shift_name in windows:
            avg_row = fetch_avg_value_in_window(cur, plant, int(meter), window_start, window_end, column)
            if not avg_row or avg_row["avg_val"] is None:
                continue
            day_key = get_production_day_key(window_start)
            day_buckets[day_key] = day_buckets.get(day_key, 0.0) + float(avg_row["avg_val"])
            day_counts[day_key] = day_counts.get(day_key, 0) + 1

        bars = []
        for day_key in sorted(day_buckets.keys()):
            avg_val = day_buckets[day_key] / max(day_counts.get(day_key, 1), 1)
            bars.append({
                "label": day_key,
                "value": round(avg_val, 2)
            })

        if bars:
            series.append({
                "label": label,
                "unit": unit,
                "bars": bars
            })

    conn.close()
    return jsonify({
        "meter_id": meter,
        "meter_name": meter_config.get("name"),
        "meter_type": "incomer",
        "selected_shift": selected_shift,
        "from_dt": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "series": series
    })


@app.route("/export_csv")
def export_csv():
    plant = request.args.get("plant")
    meter = request.args.get("meter")
    from_dt_raw = request.args.get("from_dt")
    to_dt_raw = request.args.get("to_dt")
    shift_analysis_raw = request.args.get("shift_analysis", "false")
    selected_shift = request.args.get("shift", "all")

    if not plant or not meter or not from_dt_raw or not to_dt_raw:
        return jsonify({"error": "plant, meter, from_dt and to_dt are required"}), 400

    try:
        from_dt = datetime.fromisoformat(from_dt_raw)
        to_dt = datetime.fromisoformat(to_dt_raw)
    except ValueError:
        return jsonify({"error": "Invalid datetime format"}), 400

    if to_dt <= from_dt:
        return jsonify({"error": "to_dt must be greater than from_dt"}), 400

    shift_analysis_enabled = str(shift_analysis_raw).strip().lower() in ("1", "true", "yes", "on")

    conn = get_db_connection()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    output = io.StringIO()
    writer = csv.writer(output)

    def get_windows_for_export():
        windows = get_shift_windows(from_dt, to_dt)
        if selected_shift != "all":
            windows = [w for w in windows if w[2].startswith(selected_shift)]
        return windows

    def get_submeter_consumption_for_windows(meter_id, windows):
        total = 0.0
        for window_start, window_end, _ in windows:
            w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, meter_id, window_start, window_end, "kwh")
            if not w_start_row or not w_end_row:
                continue
            total += max(0.0, float(w_end_row["val"]) - float(w_start_row["val"]))
        return round(total, 2)

    def get_production_day_floor(dt):
        day_6am = datetime.combine(dt.date(), datetime.min.time()).replace(hour=6)
        if dt < day_6am:
            day_6am -= timedelta(days=1)
        return day_6am

    def get_submeter_daily_rows(meter_id):
        rows = []
        cursor = get_production_day_floor(from_dt)
        while cursor < to_dt:
            day_start = cursor
            day_end = day_start + timedelta(days=1)
            window_start = max(day_start, from_dt)
            window_end = min(day_end, to_dt)
            if window_end <= window_start:
                cursor = day_end
                continue
            w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, meter_id, window_start, window_end, "kwh")
            if w_start_row and w_end_row:
                start_kwh = float(w_start_row["val"])
                end_kwh = float(w_end_row["val"])
                rows.append({
                    "production_day": day_start.strftime("%Y-%m-%d"),
                    "window_start": window_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "window_end": window_end.strftime("%Y-%m-%d %H:%M:%S"),
                    "start_kwh": round(start_kwh, 2),
                    "end_kwh": round(end_kwh, 2),
                    "consumption_kwh": round(max(0.0, end_kwh - start_kwh), 2)
                })
            cursor = day_end
        return rows

    if meter == "all":
        submeters = [
            (int(mid), meta.get("name", f"Meter {mid}"))
            for mid, meta in meter_map.get(plant, {}).items()
            if meta.get("type", "submeter") == "submeter"
        ]

        if shift_analysis_enabled:
            windows = get_windows_for_export()
            writer.writerow([
                "Plant", "Meter_ID", "Meter_Name", "Shift_Filter", "From_DT", "To_DT", "Consumption_KWH"
            ])
        else:
            writer.writerow([
                "Plant", "Meter_ID", "Meter_Name", "From_DT", "To_DT",
                "Start_KWH", "End_KWH", "Consumption_KWH"
            ])

        grand_total = 0.0
        for meter_id, meter_name in submeters:
            if shift_analysis_enabled:
                consumption = get_submeter_consumption_for_windows(meter_id, windows)
                grand_total += consumption
                writer.writerow([
                    plant,
                    meter_id,
                    meter_name,
                    selected_shift,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    consumption
                ])
            else:
                start_row = fetch_latest_value_at_or_before(cur, plant, meter_id, from_dt, "kwh")
                end_row = fetch_latest_value_at_or_before(cur, plant, meter_id, to_dt, "kwh")
                start_kwh = float(start_row["val"]) if start_row and start_row["val"] is not None else None
                end_kwh = float(end_row["val"]) if end_row and end_row["val"] is not None else None
                consumption = round(max(0.0, end_kwh - start_kwh), 2) if start_kwh is not None and end_kwh is not None else None
                if consumption is not None:
                    grand_total += consumption
                writer.writerow([
                    plant,
                    meter_id,
                    meter_name,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    round(start_kwh, 2) if start_kwh is not None else "",
                    round(end_kwh, 2) if end_kwh is not None else "",
                    consumption if consumption is not None else ""
                ])

        writer.writerow([])
        if shift_analysis_enabled:
            writer.writerow(["Plant", "Shift_Filter", "From_DT", "To_DT", "Total_Submeters_Consumption_KWH"])
            writer.writerow([
                plant,
                selected_shift,
                from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                round(grand_total, 2)
            ])
        else:
            writer.writerow(["Plant", "From_DT", "To_DT", "Total_Submeters_Consumption_KWH"])
            writer.writerow([
                plant,
                from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                round(grand_total, 2)
            ])
        mode_label = "shiftwise" if shift_analysis_enabled else "rangewise"
        filename = f"{plant}_all_submeters_total_kwh_{mode_label}_{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"
    else:
        try:
            meter_id = int(meter)
        except ValueError:
            conn.close()
            return jsonify({"error": "Invalid meter id"}), 400
        meter_config = meter_map.get(plant, {}).get(str(meter_id), {})
        meter_type = meter_config.get("type", "submeter")

        if meter_type == "submeter":
            if shift_analysis_enabled:
                windows = get_windows_for_export()
                writer.writerow([
                    "Plant", "Meter_ID", "Meter_Name", "Shift_Name",
                    "Window_Start", "Window_End", "Start_KWH", "End_KWH", "Consumption_KWH"
                ])
                total = 0.0
                for window_start, window_end, shift_name in windows:
                    w_start_row, w_end_row = fetch_value_bounds_in_window(cur, plant, meter_id, window_start, window_end, "kwh")
                    if not w_start_row or not w_end_row:
                        continue
                    start_kwh = float(w_start_row["val"])
                    end_kwh = float(w_end_row["val"])
                    consumption = round(max(0.0, end_kwh - start_kwh), 2)
                    total += consumption
                    writer.writerow([
                        plant,
                        meter_id,
                        meter_config.get("name", f"Meter {meter_id}"),
                        shift_name,
                        window_start.strftime("%Y-%m-%d %H:%M:%S"),
                        window_end.strftime("%Y-%m-%d %H:%M:%S"),
                        round(start_kwh, 2),
                        round(end_kwh, 2),
                        consumption
                    ])
                writer.writerow([])
                writer.writerow(["Plant", "Meter_ID", "Meter_Name", "Shift_Filter", "From_DT", "To_DT", "Total_Consumption_KWH"])
                writer.writerow([
                    plant,
                    meter_id,
                    meter_config.get("name", f"Meter {meter_id}"),
                    selected_shift,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    round(total, 2)
                ])
            else:
                start_row = fetch_latest_value_at_or_before(cur, plant, meter_id, from_dt, "kwh")
                end_row = fetch_latest_value_at_or_before(cur, plant, meter_id, to_dt, "kwh")
                start_kwh = float(start_row["val"]) if start_row and start_row["val"] is not None else None
                end_kwh = float(end_row["val"]) if end_row and end_row["val"] is not None else None
                consumption = round(max(0.0, end_kwh - start_kwh), 2) if start_kwh is not None and end_kwh is not None else None
                writer.writerow([
                    "Plant", "Meter_ID", "Meter_Name", "From_DT", "To_DT",
                    "Start_KWH", "End_KWH", "Consumption_KWH"
                ])
                writer.writerow([
                    plant,
                    meter_id,
                    meter_config.get("name", f"Meter {meter_id}"),
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    round(start_kwh, 2) if start_kwh is not None else "",
                    round(end_kwh, 2) if end_kwh is not None else "",
                    consumption if consumption is not None else ""
                ])

            daily_rows = get_submeter_daily_rows(meter_id)
            if daily_rows:
                writer.writerow([])
                writer.writerow([
                    "Production_Day", "Window_Start", "Window_End",
                    "Start_KWH", "End_KWH", "Consumption_KWH"
                ])
                for drow in daily_rows:
                    writer.writerow([
                        drow["production_day"],
                        drow["window_start"],
                        drow["window_end"],
                        drow["start_kwh"],
                        drow["end_kwh"],
                        drow["consumption_kwh"]
                    ])
            filename = f"{plant}_submeter_{meter_id}_{'shiftwise' if shift_analysis_enabled else 'rangewise'}_{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"
        else:
            query = """
                SELECT
                    timestamp, plant, meter_id, meter_name, meter_type, status,
                    kwh, kw, kva, pf, volt, curr, freq,
                    line_voltage, line_to_line_voltage, avg_voltage, voltage_unbalance,
                    line_current, current_l1, current_l2, current_l3, avg_current,
                    neutral_line_current, kw_l1, kw_l2, kw_l3, kw_total,
                    kva_l1, kva_l2, kva_l3, kva_total, kva_max_demand
                FROM meter_data
                WHERE plant=? AND meter_id=? AND timestamp>=? AND timestamp<=?
                ORDER BY timestamp ASC
            """
            cur.execute(query, [
                plant,
                meter_id,
                from_dt.strftime("%Y-%m-%d %H:%M:%S"),
                to_dt.strftime("%Y-%m-%d %H:%M:%S")
            ])
            rows = cur.fetchall()

            writer.writerow([
                "Timestamp", "Plant", "Meter_ID", "Meter_Name", "Meter_Type", "Status",
                "KWH", "KW", "KVA", "PF", "Volt", "Curr", "Freq",
                "Line_Voltage", "Line_To_Line_Voltage", "Avg_Voltage", "Voltage_Unbalance",
                "Line_Current", "Current_L1", "Current_L2", "Current_L3", "Avg_Current",
                "Neutral_Line_Current", "KW_L1", "KW_L2", "KW_L3", "KW_Total",
                "KVA_L1", "KVA_L2", "KVA_L3", "KVA_Total", "KVA_Max_Demand"
            ])
            for row in rows:
                writer.writerow([row[col] for col in row.keys()])

            filename = f"{plant}_incomer_{meter_id}_{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"

    conn.close()
    csv_data = output.getvalue()
    output.close()

    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename=\"{filename}\"'}
    )

if __name__ == "__main__":
    # Flask debug reloader launches two processes.
    # Start UDP thread only in the active reloader child (or when reloader is off).
    if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_udp_server_once()
    app.run(debug=True, host="0.0.0.0", port=10012)



