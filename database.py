import os
import json

import psycopg2

from config import DB_DSN, BASE_DIR


def get_db_connection():
    """Return a new psycopg2 connection."""
    return psycopg2.connect(DB_DSN)


def init_db():
    """Create tables, add missing columns, create indexes, and seed from meter_map.json."""
    conn = get_db_connection()
    cur = conn.cursor()

    # ── meter_data table ───────────────────────────────────────────────────────
    cur.execute("""
    CREATE TABLE IF NOT EXISTS meter_data (
        id                   SERIAL PRIMARY KEY,
        plant                TEXT,
        meter_id             INTEGER,
        meter_name           TEXT,
        meter_type           TEXT,
        status               TEXT,
        freq                 REAL,
        volt                 REAL,
        curr                 REAL,
        pf                   REAL,
        kw                   REAL,
        kva                  REAL,
        kwh                  REAL,
        line_voltage         REAL,
        line_to_line_voltage REAL,
        avg_voltage          REAL,
        voltage_unbalance    REAL,
        line_current         REAL,
        current_l1           REAL,
        current_l2           REAL,
        current_l3           REAL,
        avg_current          REAL,
        neutral_line_current REAL,
        kw_l1                REAL,
        kw_l2                REAL,
        kw_l3                REAL,
        kw_total             REAL,
        kva_l1               REAL,
        kva_l2               REAL,
        kva_l3               REAL,
        kva_total            REAL,
        kva_max_demand       REAL,
        timestamp            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Add any columns that may be missing (migration safety) ─────────────────
    cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name='meter_data'"
    )
    existing_columns = {row[0] for row in cur.fetchall()}
    required_columns = [
        ("line_voltage",         "REAL"),
        ("line_to_line_voltage", "REAL"),
        ("avg_voltage",          "REAL"),
        ("voltage_unbalance",    "REAL"),
        ("line_current",         "REAL"),
        ("current_l1",           "REAL"),
        ("current_l2",           "REAL"),
        ("current_l3",           "REAL"),
        ("avg_current",          "REAL"),
        ("neutral_line_current", "REAL"),
        ("kw_l1",                "REAL"),
        ("kw_l2",                "REAL"),
        ("kw_l3",                "REAL"),
        ("kw_total",             "REAL"),
        ("kva_l1",               "REAL"),
        ("kva_l2",               "REAL"),
        ("kva_l3",               "REAL"),
        ("kva_total",            "REAL"),
        ("kva_max_demand",       "REAL"),
    ]
    for col_name, col_type in required_columns:
        if col_name not in existing_columns:
            cur.execute(f"ALTER TABLE meter_data ADD COLUMN {col_name} {col_type}")

    # ── Indexes ────────────────────────────────────────────────────────────────
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_meter_data_plant_meter_ts "
        "ON meter_data (plant, meter_id, timestamp)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_meter_data_plant_ts "
        "ON meter_data (plant, timestamp)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_meter_data_ts ON meter_data (timestamp)"
    )

    # ── meter_config table ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS meter_config (
            id       SERIAL PRIMARY KEY,
            plant    TEXT,
            meter_id INTEGER,
            name     TEXT,
            type     TEXT
        )
    """)

    # ── plants table ───────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS plants (
            id   SERIAL PRIMARY KEY,
            name TEXT UNIQUE
        )
    """)

    # ── device_heartbeats table ────────────────────────────────────────────────
    # Logs every UDP packet received — even from unconfigured devices.
    # Allows the Admin dashboard to discover which PLANT_IDs are active.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS device_heartbeats (
            device_id    TEXT PRIMARY KEY,
            last_seen    TIMESTAMP NOT NULL,
            ip_addr      TEXT,
            meter_count  INTEGER DEFAULT 0,
            meter_ids    TEXT,
            is_configured BOOLEAN DEFAULT FALSE
        )
    """)

    # ── device_configs table ───────────────────────────────────────────────────
    # Maps a hardware PLANT_ID (e.g. "20236") → plant name (e.g. "Architecture")
    # Managed from Admin Dashboard — no firmware changes needed to reassign.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS device_configs (
            device_id  TEXT PRIMARY KEY,   -- firmware PLANT_ID e.g. "20236"
            plant      TEXT NOT NULL,      -- maps to plants.name
            label      TEXT DEFAULT ''     -- optional friendly label
        )
    """)

    # ── meter_groups table ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS meter_groups (
            id   SERIAL PRIMARY KEY,
            name TEXT UNIQUE
        )
    """)

    # ── meter_group_members table ──────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS meter_group_members (
            id       SERIAL PRIMARY KEY,
            group_id INTEGER REFERENCES meter_groups(id) ON DELETE CASCADE,
            plant    TEXT NOT NULL,
            meter_id INTEGER NOT NULL,
            UNIQUE (group_id, plant, meter_id)
        )
    """)

    # ── Seed from meter_map.json (first run only) ──────────────────────────────
    cur.execute("SELECT COUNT(*) FROM meter_config")
    if cur.fetchone()[0] == 0:
        json_path = os.path.join(BASE_DIR, "meter_map.json")
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                try:
                    meter_map = json.load(f)
                    for plant, meters in meter_map.items():
                        cur.execute(
                            "INSERT INTO plants (name) VALUES (%s) ON CONFLICT DO NOTHING",
                            (plant,)
                        )
                        for m_id, m_info in meters.items():
                            cur.execute(
                                "INSERT INTO meter_config (plant, meter_id, name, type) "
                                "VALUES (%s, %s, %s, %s)",
                                (plant, int(m_id), m_info.get("name"), m_info.get("type"))
                            )
                except Exception as e:
                    print("Error migrating meter_map.json:", e)

    cur.execute(
        "INSERT INTO plants (name) "
        "SELECT DISTINCT plant FROM meter_config ON CONFLICT DO NOTHING"
    )

    # ── group_daily_summary table ──────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS group_daily_summary (
            id         SERIAL PRIMARY KEY,
            group_id   INTEGER REFERENCES meter_groups(id) ON DELETE CASCADE,
            date       DATE NOT NULL,
            total_kwh  REAL NOT NULL,
            UNIQUE (group_id, date)
        )
    """)

    # ── vw_group_live_status view ──────────────────────────────────────────────
    cur.execute("""
        CREATE OR REPLACE VIEW vw_group_live_status AS
        SELECT 
            g.id AS group_id,
            g.name AS group_name,
            SUM(latest_md.kw) AS total_kw,
            SUM(latest_md.kwh) AS total_kwh,
            MAX(latest_md.timestamp) AS last_updated
        FROM meter_groups g
        JOIN meter_group_members gm ON g.id = gm.group_id
        JOIN (
            SELECT DISTINCT ON (plant, meter_id) *
            FROM meter_data
            ORDER BY plant, meter_id, timestamp DESC
        ) latest_md ON gm.plant = latest_md.plant AND gm.meter_id = latest_md.meter_id
        GROUP BY g.id, g.name;
    """)

    conn.commit()
    conn.close()
