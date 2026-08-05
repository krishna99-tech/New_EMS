"""
udp_server.py — background UDP listener.

Receives JSON payloads from energy meters and inserts rows into meter_data.
Also writes a heartbeat record for every packet so the Admin dashboard
can show which devices are active — even before they are configured.
"""

import json
import socket
import asyncio
from datetime import datetime

from config import UDP_IP, UDP_PORT
from database import get_db_connection
from helpers import get_meter_config, get_incomer_meter_id_for_plant
from routers.ws import manager


def _upsert_heartbeat(cur, device_id: str, ip_addr: str, meters: list):
    """Update the device_heartbeats row for this device_id (INSERT or UPDATE)."""
    responding = [str(m.get("id")) for m in meters if m.get("status") == "OK"]
    meter_ids_str = ",".join(responding)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Check whether this device_id is mapped to a plant in device_configs
    cur.execute(
        "SELECT 1 FROM device_configs WHERE device_id=%s",
        (device_id,)
    )
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


def udp_server(loop=None):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind((UDP_IP, UDP_PORT))
    except OSError as e:
        print(f"UDP bind failed on {UDP_IP}:{UDP_PORT}: {e}")
        return

    print(f"UDP Server Listening on {UDP_PORT}")

    while True:
        data, addr = sock.recvfrom(4096)
        ip_addr = addr[0]
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            payload = json.loads(data.decode())
            raw_device_id = payload.get("device", "Unknown")  # e.g. "20236"
            meters_list = payload.get("meters", [])

            # ── Resolve plant name from device_configs ────────────────────────
            # If not registered, fall back to raw device_id so heartbeat still works.
            cur.execute(
                "SELECT plant FROM device_configs WHERE device_id=%s",
                (raw_device_id,)
            )
            row = cur.fetchone()
            plant = row[0] if row else None   # None = unconfigured device

            # ── Always log heartbeat first (works even without config) ─────────
            _upsert_heartbeat(cur, raw_device_id, ip_addr, meters_list)

            # Broadcast update to UI
            if loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast('{"event": "heartbeat_updated"}'),
                    loop
                )

            if plant is None:
                # Device not registered → log heartbeat only, skip data storage
                print(f"[UDP] Unknown device '{raw_device_id}' from {ip_addr} — "
                      f"register it in Admin > Discovered Devices")
                conn.commit()
                conn.close()
                continue

            # ── Store meter readings for configured + named meters only ────────
            for meter in meters_list:
                meter_id = str(meter.get("id"))
                config = get_meter_config(plant, meter_id)
                meter_name = config.get("name", f"Meter {meter_id}")
                meter_type = config.get("type", "submeter")

                configured_incomer_id = get_incomer_meter_id_for_plant(plant)
                is_incomer = (
                    configured_incomer_id is not None
                    and meter_id == configured_incomer_id
                )

                if not is_incomer:
                    meter_type = "submeter"

                row_ts = (
                    meter.get("timestamp")
                    or payload.get("timestamp")
                    or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                )

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
                        (
                            plant, meter.get("id"), meter_name, meter_type,
                            meter.get("status"), meter.get("kwh"), row_ts,
                        ),
                    )

            conn.commit()
            conn.close()
        except Exception as e:
            print("Error processing UDP payload:", e)
