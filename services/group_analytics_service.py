from datetime import datetime, timedelta

import psycopg2.extras

from database import get_db_connection
from helpers import (
    compute_live_status,
    fetch_latest_value_at_or_before,
    fetch_value_bounds_in_window,
    get_meter_config,
    get_production_day_key,
    get_shift_name,
    get_shift_start,
)
from services import group_service


def get_production_day_start(dt: datetime) -> datetime:
    if dt.hour >= 6:
        return datetime.combine(dt.date(), datetime.min.time()).replace(hour=6)
    return datetime.combine(dt.date() - timedelta(days=1), datetime.min.time()).replace(hour=6)


def compute_meter_consumption(cur, plant: str, meter_id: int, from_dt: datetime, to_dt: datetime):
    in_window_start, in_window_end = fetch_value_bounds_in_window(
        cur, plant, meter_id, from_dt, to_dt, "kwh"
    )
    if not in_window_end:
        return None

    start_row = fetch_latest_value_at_or_before(cur, plant, meter_id, from_dt, "kwh")
    if not start_row:
        start_row = in_window_start
    if not start_row:
        return None

    start_kwh = float(start_row["val"])
    end_kwh = float(in_window_end["val"])
    return {
        "start_kwh": round(start_kwh, 2),
        "end_kwh": round(end_kwh, 2),
        "consumption": round(max(0, end_kwh - start_kwh), 2),
    }


def get_member_breakdown(cur, members, from_dt: datetime, to_dt: datetime):
    breakdown = []
    for member in members:
        plant = member["plant"]
        meter_id = int(member["meter_id"])
        cfg = get_meter_config(plant, meter_id)
        meter_name = cfg.get("name") or f"Meter {meter_id}"

        cons = compute_meter_consumption(cur, plant, meter_id, from_dt, to_dt)
        if cons:
            breakdown.append({
                "plant": plant,
                "meter_id": str(meter_id),
                "meter_name": meter_name,
                **cons,
            })
        else:
            breakdown.append({
                "plant": plant,
                "meter_id": str(meter_id),
                "meter_name": meter_name,
                "start_kwh": None,
                "end_kwh": None,
                "consumption": None,
            })
    return breakdown


def get_yesterday_kwh(cur, group_id: int, members, yesterday_start: datetime, yesterday_end: datetime):
    cur.execute(
        "SELECT total_kwh FROM group_daily_summary WHERE group_id=%s AND date=%s",
        (group_id, yesterday_start.date()),
    )
    row = cur.fetchone()
    if row and row.get("total_kwh") is not None:
        return float(row["total_kwh"])

    total = 0.0
    has_data = False
    for member in members:
        cons = compute_meter_consumption(
            cur, member["plant"], int(member["meter_id"]), yesterday_start, yesterday_end
        )
        if cons:
            total += cons["consumption"]
            has_data = True
    return round(total, 2) if has_data else None


def get_group_live_kpis(group_id: int):
    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        return None

    members = group_data["members"]
    now = datetime.now()
    shift_start = get_shift_start(now)
    prod_day_start = get_production_day_start(now)
    yesterday_start = prod_day_start - timedelta(days=1)
    yesterday_end = prod_day_start

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    register_total = 0.0
    online_count = 0
    current_shift_kwh = 0.0
    today_kwh = 0.0
    has_shift_data = False
    has_today_data = False
    last_updated = None

    meter_snapshots = []
    for member in members:
        plant = member["plant"]
        meter_id = int(member["meter_id"])
        cfg = get_meter_config(plant, meter_id)

        cur.execute(
            "SELECT kwh, timestamp FROM meter_data "
            "WHERE plant=%s AND meter_id=%s ORDER BY timestamp DESC LIMIT 1",
            (plant, meter_id),
        )
        row = cur.fetchone()
        if not row:
            meter_snapshots.append({
                "plant": plant,
                "meter_id": str(meter_id),
                "meter_name": cfg.get("name") or f"Meter {meter_id}",
                "kwh": None,
                "timestamp": None,
                "status": "Offline",
            })
            continue

        kwh_val = float(row.get("kwh") or 0)
        register_total += kwh_val

        ts = row.get("timestamp")
        if isinstance(ts, datetime):
            ts_str = ts.strftime("%Y-%m-%d %H:%M:%S")
        else:
            ts_str = str(ts) if ts else None

        status = compute_live_status({"timestamp": ts_str})
        if status == "OK":
            online_count += 1

        if ts_str and (last_updated is None or ts_str > last_updated):
            last_updated = ts_str

        shift_cons = compute_meter_consumption(cur, plant, meter_id, shift_start, now)
        if shift_cons:
            current_shift_kwh += shift_cons["consumption"]
            has_shift_data = True

        today_cons = compute_meter_consumption(cur, plant, meter_id, prod_day_start, now)
        if today_cons:
            today_kwh += today_cons["consumption"]
            has_today_data = True

        meter_snapshots.append({
            "plant": plant,
            "meter_id": str(meter_id),
            "meter_name": cfg.get("name") or f"Meter {meter_id}",
            "kwh": round(kwh_val, 2),
            "timestamp": ts_str,
            "status": status,
        })

    yesterday_kwh = get_yesterday_kwh(cur, group_id, members, yesterday_start, yesterday_end) if members else None

    conn.close()

    delta_pct = None
    if yesterday_kwh and yesterday_kwh > 0 and has_today_data:
        delta_pct = round(((today_kwh - yesterday_kwh) / yesterday_kwh) * 100, 1)

    return {
        "group_id": group_id,
        "name": group_data["name"],
        "production_day": get_production_day_key(now),
        "current_shift_name": get_shift_name(now),
        "current_shift_start": shift_start.strftime("%Y-%m-%d %H:%M:%S"),
        "register_total_kwh": round(register_total, 2),
        "current_shift_consumption_kwh": round(current_shift_kwh, 2) if has_shift_data else None,
        "today_consumption_kwh": round(today_kwh, 2) if has_today_data else None,
        "yesterday_consumption_kwh": yesterday_kwh,
        "today_vs_yesterday_pct": delta_pct,
        "member_count": len(members),
        "online_count": online_count,
        "last_updated": last_updated,
        "meters": meter_snapshots,
    }


def compare_groups_live(group_ids: list):
    results = []
    for gid in group_ids:
        data = get_group_live_kpis(gid)
        if not data:
            continue
        results.append({
            "group_id": data["group_id"],
            "name": data["name"],
            "member_count": data["member_count"],
            "online_count": data["online_count"],
            "current_shift_kwh": data["current_shift_consumption_kwh"],
            "today_kwh": data["today_consumption_kwh"],
            "yesterday_kwh": data["yesterday_consumption_kwh"],
            "today_vs_yesterday_pct": data["today_vs_yesterday_pct"],
        })
    return results


def compare_groups_period(group_ids: list, from_dt: datetime, to_dt: datetime):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    results = []

    for gid in group_ids:
        group_data = group_service.get_group_with_members(gid)
        if not group_data:
            continue
        members = group_data["members"]
        breakdown = get_member_breakdown(cur, members, from_dt, to_dt)
        total = sum(m["consumption"] for m in breakdown if m.get("consumption") is not None)
        results.append({
            "group_id": gid,
            "name": group_data["name"],
            "member_count": len(members),
            "total_kwh": round(total, 2),
            "meters_with_data": sum(1 for m in breakdown if m.get("consumption") is not None),
        })

    conn.close()
    return results
