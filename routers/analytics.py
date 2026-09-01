"""
routers/analytics.py — energy summary and incomer shift analysis routes.

Routes:
  GET /energy_summary
  GET /group_energy_summary
  GET /group_live_kpis
  GET /incomer_shift_summary
"""

from datetime import datetime, timedelta

import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request

from database import get_db_connection
from helpers import (
    fetch_avg_value_in_window,
    fetch_latest_value_at_or_before,
    fetch_value_bounds_in_window,
    get_all_meters,
    get_meter_config,
    get_production_day_key,
    get_shift_name,
    get_shift_start,
    get_shift_windows,
)
from services import group_service
from services.group_analytics_service import get_group_live_kpis, get_member_breakdown, compare_groups_live, compare_groups_period
from routers.auth import require_login

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# /energy_summary
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/energy_summary")
def energy_summary(
    plant: str = None,
    meter: str = None,
    mode: str = "shiftwise",
    shift: str = "all",
    from_dt: str = None,
    to_dt: str = None,
):
    selected_shift  = shift
    from_dt_raw     = from_dt
    to_dt_raw       = to_dt

    if not plant or not meter:
        raise HTTPException(status_code=400, detail="plant and meter are required")

    now = datetime.now()
    if from_dt_raw and to_dt_raw:
        try:
            from_dt = datetime.fromisoformat(from_dt_raw)
            to_dt   = datetime.fromisoformat(to_dt_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid datetime format")
    else:
        today_6am = datetime.combine(now.date(), datetime.min.time()).replace(hour=6)
        if now < today_6am:
            today_6am -= timedelta(days=1)
        from_dt = today_6am - timedelta(days=1)
        to_dt   = today_6am

    if to_dt <= from_dt:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    conn = get_db_connection()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    meter_config = get_meter_config(plant, meter)
    if not meter_config:
        conn.close()
        raise HTTPException(status_code=404, detail="Meter not found")

    meter_type   = meter_config.get("type", "submeter")
    value_column = "kwh"
    unit         = "kWh"
    metric_name  = "Energy Consumption"

    in_window_start, in_window_end = fetch_value_bounds_in_window(
        cur, plant, int(meter), from_dt, to_dt, value_column
    )
    if not in_window_end:
        start_kwh         = None
        end_kwh           = None
        total_consumption = None
    else:
        start_row         = fetch_latest_value_at_or_before(cur, plant, int(meter), from_dt, value_column)
        start_kwh         = float(start_row["val"]) if start_row else float(in_window_start["val"])
        end_kwh           = float(in_window_end["val"])
        total_consumption = round(max(0, end_kwh - start_kwh), 2)

    shift_start_dt  = get_shift_start(now)
    shift_end_dt    = shift_start_dt + timedelta(hours=8)
    shift_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), shift_start_dt, value_column)
    shift_now_row   = fetch_latest_value_at_or_before(cur, plant, int(meter), now, value_column)

    current_shift_start_kwh = float(shift_start_row["val"]) if shift_start_row and shift_start_row["val"] is not None else None
    current_shift_end_kwh   = float(shift_now_row["val"])   if shift_now_row   and shift_now_row["val"]   is not None else None
    current_shift_consumption = None
    if current_shift_start_kwh is not None and current_shift_end_kwh is not None:
        current_shift_consumption = round(max(0, current_shift_end_kwh - current_shift_start_kwh), 2)

    bars = []
    if mode == "totalshifts":
        windows = get_shift_windows(from_dt, to_dt)
        for idx, (window_start, window_end, shift_name) in enumerate(windows, start=1):
            in_window_first, in_window_last = fetch_value_bounds_in_window(
                cur, plant, int(meter), window_start, window_end, value_column
            )
            if not in_window_last:
                continue
            w_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), window_start, value_column)
            if not w_start_row:
                w_start_row = in_window_first
            w_end_row = in_window_last
            if not w_start_row or not w_end_row:
                continue
            cons = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
            bars.append({
                "label":      f"Shift {idx}",
                "shift_name": shift_name,
                "start":      window_start.strftime("%Y-%m-%d %H:%M:%S"),
                "end":        window_end.strftime("%Y-%m-%d %H:%M:%S"),
                "start_kwh":  round(float(w_start_row["val"]), 2),
                "end_kwh":    round(float(w_end_row["val"]), 2),
                "consumption": cons,
            })
    else:
        windows = get_shift_windows(from_dt, to_dt)
        if selected_shift != "all":
            day_buckets: dict = {}
            for window_start, window_end, shift_name in windows:
                if not shift_name.startswith(selected_shift):
                    continue
                in_window_first, in_window_last = fetch_value_bounds_in_window(
                    cur, plant, int(meter), window_start, window_end, value_column
                )
                if not in_window_last:
                    continue
                w_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), window_start, value_column)
                if not w_start_row:
                    w_start_row = in_window_first
                w_end_row = in_window_last
                if not w_start_row or not w_end_row:
                    continue
                cons    = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
                day_key = get_production_day_key(window_start)
                if day_key not in day_buckets:
                    day_buckets[day_key] = {
                        "consumption": cons,
                        "start_kwh":   float(w_start_row["val"]),
                        "end_kwh":     float(w_end_row["val"]),
                    }
                else:
                    day_buckets[day_key]["consumption"] += cons
                    day_buckets[day_key]["start_kwh"] = min(day_buckets[day_key]["start_kwh"], float(w_start_row["val"]))
                    day_buckets[day_key]["end_kwh"]   = max(day_buckets[day_key]["end_kwh"],   float(w_end_row["val"]))
            for day_key in sorted(day_buckets.keys()):
                bars.append({
                    "label":       day_key,
                    "shift_name":  selected_shift,
                    "start":       f"{day_key} 06:00:00",
                    "end":         (datetime.strptime(day_key, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d 06:00:00"),
                    "start_kwh":   round(day_buckets[day_key]["start_kwh"], 2),
                    "end_kwh":     round(day_buckets[day_key]["end_kwh"], 2),
                    "consumption": round(day_buckets[day_key]["consumption"], 2),
                })
        else:
            day_buckets = {}
            for window_start, window_end, _shift_name in windows:
                in_window_first, in_window_last = fetch_value_bounds_in_window(
                    cur, plant, int(meter), window_start, window_end, value_column
                )
                if not in_window_last:
                    continue
                w_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), window_start, value_column)
                if not w_start_row:
                    w_start_row = in_window_first
                w_end_row = in_window_last
                if not w_start_row or not w_end_row:
                    continue
                cons    = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
                day_key = get_production_day_key(window_start)
                if day_key not in day_buckets:
                    day_buckets[day_key] = {
                        "consumption": cons,
                        "start_kwh":   float(w_start_row["val"]),
                        "end_kwh":     float(w_end_row["val"]),
                    }
                else:
                    day_buckets[day_key]["consumption"] += cons
                    day_buckets[day_key]["start_kwh"] = min(day_buckets[day_key]["start_kwh"], float(w_start_row["val"]))
                    day_buckets[day_key]["end_kwh"]   = max(day_buckets[day_key]["end_kwh"],   float(w_end_row["val"]))
            for day_key in sorted(day_buckets.keys()):
                bars.append({
                    "label":       day_key,
                    "shift_name":  "All Shifts",
                    "start":       f"{day_key} 06:00:00",
                    "end":         (datetime.strptime(day_key, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d 06:00:00"),
                    "start_kwh":   round(day_buckets[day_key]["start_kwh"], 2),
                    "end_kwh":     round(day_buckets[day_key]["end_kwh"], 2),
                    "consumption": round(day_buckets[day_key]["consumption"], 2),
                })

    # ── Totals ─────────────────────────────────────────────────────────────────
    if mode == "custom":
        selected_total_kwh = total_consumption
        selected_start_kwh = start_kwh
        selected_end_kwh   = end_kwh
        valid_window_count = 1 if (start_kwh is not None and end_kwh is not None) else 0
    else:
        selected_total_kwh = round(sum((b.get("consumption") or 0) for b in bars), 2)
        selected_windows   = get_shift_windows(from_dt, to_dt)
        if selected_shift != "all":
            selected_windows = [w for w in selected_windows if w[2].startswith(selected_shift)]

        first_start_row    = None
        last_end_row       = None
        valid_window_count = 0
        for window_start, window_end, _ in selected_windows:
            w_start_row = fetch_latest_value_at_or_before(cur, plant, int(meter), window_start, value_column)
            if not w_start_row:
                w_start_row, _ = fetch_value_bounds_in_window(cur, plant, int(meter), window_start, window_end, value_column)
            w_end_row = fetch_latest_value_at_or_before(cur, plant, int(meter), window_end, value_column)
            if not w_start_row or not w_end_row:
                continue
            valid_window_count += 1
            if first_start_row is None:
                first_start_row = w_start_row
            last_end_row = w_end_row

        if first_start_row and last_end_row:
            selected_start_kwh = float(first_start_row["val"])
            selected_end_kwh   = float(last_end_row["val"])
        else:
            selected_start_kwh = start_kwh if selected_shift == "all" else None
            selected_end_kwh   = end_kwh   if selected_shift == "all" else None

    conn.close()
    return {
        "meter_id":                    meter,
        "meter_name":                  meter_config.get("name"),
        "meter_type":                  meter_type,
        "value_unit":                  unit,
        "metric_name":                 metric_name,
        "mode":                        mode,
        "selected_shift":              selected_shift,
        "from_dt":                     from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt":                       to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "yesterday_total_kwh":         total_consumption,
        "range_start_kwh":             selected_start_kwh,
        "range_end_kwh":               selected_end_kwh,
        "current_shift_name":          get_shift_name(now),
        "current_shift_start":         shift_start_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_end":           shift_end_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_start_kwh":     current_shift_start_kwh,
        "current_shift_end_kwh":       current_shift_end_kwh,
        "current_shift_consumption_kwh": current_shift_consumption,
        "selected_total_kwh":          selected_total_kwh,
        "has_shift_window_data":       valid_window_count > 0,
        "bars":                        bars,
    }


# ══════════════════════════════════════════════════════════════════════════════
# /group_energy_summary
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/group_energy_summary")
def group_energy_summary(
    request: Request,
    group_id: int = None,
    mode: str = "shiftwise",
    shift: str = "all",
    from_dt: str = None,
    to_dt: str = None,
):
    require_login(request)
    selected_shift  = shift
    from_dt_raw     = from_dt
    to_dt_raw       = to_dt

    if not group_id:
        raise HTTPException(status_code=400, detail="group_id is required")

    now = datetime.now()
    if from_dt_raw and to_dt_raw:
        try:
            from_dt = datetime.fromisoformat(from_dt_raw)
            to_dt   = datetime.fromisoformat(to_dt_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid datetime format")
    else:
        today_6am = datetime.combine(now.date(), datetime.min.time()).replace(hour=6)
        if now < today_6am:
            today_6am -= timedelta(days=1)
        from_dt = today_6am - timedelta(days=1)
        to_dt   = today_6am

    if to_dt <= from_dt:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    conn = get_db_connection()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        conn.close()
        raise HTTPException(status_code=404, detail="Group not found")
        
    group_name = group_data["name"]
    members = group_data["members"]

    if not members:
        conn.close()
        return {
            "meter_id": group_id,
            "meter_name": group_name,
            "meter_type": "group",
            "value_unit": "kWh",
            "metric_name": "Group Energy Consumption",
            "mode": mode,
            "selected_shift": selected_shift,
            "from_dt": from_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "to_dt": to_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "has_shift_window_data": False,
            "bars": [],
            "yesterday_total_kwh": 0,
            "selected_total_kwh": 0,
            "members": [],
        }

    value_column = "kwh"
    unit         = "kWh"
    metric_name  = "Group Energy Consumption"

    # We will aggregate consumption per bucket across all meters
    # A bucket is defined by its label (e.g. shift name or day)
    # Since each meter might have different start/end kWh for a bucket, we just sum the consumption
    
    total_group_consumption = 0
    
    aggregated_bars = {}

    shift_start_dt  = get_shift_start(now)
    shift_end_dt    = shift_start_dt + timedelta(hours=8)
    
    current_shift_consumption_total = 0
    has_current_shift_data = False

    for member in members:
        m_plant = member["plant"]
        m_meter = int(member["meter_id"])
        
        # Total consumption for this member in the overall window
        in_window_start, in_window_end = fetch_value_bounds_in_window(
            cur, m_plant, m_meter, from_dt, to_dt, value_column
        )
        if in_window_end:
            start_row         = fetch_latest_value_at_or_before(cur, m_plant, m_meter, from_dt, value_column)
            start_kwh         = float(start_row["val"]) if start_row else float(in_window_start["val"])
            end_kwh           = float(in_window_end["val"])
            total_group_consumption += round(max(0, end_kwh - start_kwh), 2)

        # Current shift consumption
        s_start_row = fetch_latest_value_at_or_before(cur, m_plant, m_meter, shift_start_dt, value_column)
        s_now_row   = fetch_latest_value_at_or_before(cur, m_plant, m_meter, now, value_column)
        if s_start_row and s_start_row["val"] is not None and s_now_row and s_now_row["val"] is not None:
            current_shift_consumption_total += round(max(0, float(s_now_row["val"]) - float(s_start_row["val"])), 2)
            has_current_shift_data = True

        windows = get_shift_windows(from_dt, to_dt)
        if mode == "totalshifts":
            for idx, (window_start, window_end, shift_name) in enumerate(windows, start=1):
                bucket_key = f"Shift {idx}_{shift_name}_{window_start.strftime('%Y-%m-%d %H:%M:%S')}"
                
                in_window_first, in_window_last = fetch_value_bounds_in_window(
                    cur, m_plant, m_meter, window_start, window_end, value_column
                )
                if not in_window_last:
                    continue
                w_start_row = fetch_latest_value_at_or_before(cur, m_plant, m_meter, window_start, value_column)
                if not w_start_row:
                    w_start_row = in_window_first
                w_end_row = in_window_last
                if not w_start_row or not w_end_row:
                    continue
                    
                cons = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
                
                if bucket_key not in aggregated_bars:
                    aggregated_bars[bucket_key] = {
                        "label": f"Shift {idx}",
                        "shift_name": shift_name,
                        "start": window_start.strftime("%Y-%m-%d %H:%M:%S"),
                        "end": window_end.strftime("%Y-%m-%d %H:%M:%S"),
                        "consumption": 0,
                        "start_kwh": 0,
                        "end_kwh": 0
                    }
                aggregated_bars[bucket_key]["consumption"] += cons
                aggregated_bars[bucket_key]["start_kwh"] += float(w_start_row["val"])
                aggregated_bars[bucket_key]["end_kwh"] += float(w_end_row["val"])
        else:
            # daywise grouping
            for window_start, window_end, s_name in windows:
                if selected_shift != "all" and not s_name.startswith(selected_shift):
                    continue
                    
                in_window_first, in_window_last = fetch_value_bounds_in_window(
                    cur, m_plant, m_meter, window_start, window_end, value_column
                )
                if not in_window_last:
                    continue
                w_start_row = fetch_latest_value_at_or_before(cur, m_plant, m_meter, window_start, value_column)
                if not w_start_row:
                    w_start_row = in_window_first
                w_end_row = in_window_last
                if not w_start_row or not w_end_row:
                    continue
                    
                cons = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
                day_key = get_production_day_key(window_start)
                
                bucket_key = day_key
                if bucket_key not in aggregated_bars:
                    aggregated_bars[bucket_key] = {
                        "label": day_key,
                        "shift_name": selected_shift if selected_shift != "all" else "All Shifts",
                        "start": f"{day_key} 06:00:00",
                        "end": (datetime.strptime(day_key, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d 06:00:00"),
                        "consumption": 0,
                        "start_kwh": 0,
                        "end_kwh": 0
                    }
                aggregated_bars[bucket_key]["consumption"] += cons
                aggregated_bars[bucket_key]["start_kwh"] += float(w_start_row["val"])
                aggregated_bars[bucket_key]["end_kwh"] += float(w_end_row["val"])

    bars = list(aggregated_bars.values())
    # Sort bars by start date
    bars.sort(key=lambda x: x["start"])
    
    # round values
    for b in bars:
        b["consumption"] = round(b["consumption"], 2)
        b["start_kwh"] = round(b["start_kwh"], 2)
        b["end_kwh"] = round(b["end_kwh"], 2)

    selected_total_kwh = round(sum(b["consumption"] for b in bars), 2) if bars else round(total_group_consumption, 2)
    selected_start_kwh = round(sum(b["start_kwh"] for b in bars if "start_kwh" in b), 2)
    selected_end_kwh = round(sum(b["end_kwh"] for b in bars if "end_kwh" in b), 2)
    members_breakdown = get_member_breakdown(cur, members, from_dt, to_dt)

    conn.close()
    return {
        "meter_id":                    group_id,
        "meter_name":                  group_name,
        "meter_type":                  "group",
        "value_unit":                  unit,
        "metric_name":                 metric_name,
        "mode":                        mode,
        "selected_shift":              selected_shift,
        "from_dt":                     from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt":                       to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "yesterday_total_kwh":         round(total_group_consumption, 2),
        "range_start_kwh":             selected_start_kwh,
        "range_end_kwh":               selected_end_kwh,
        "current_shift_name":          get_shift_name(now),
        "current_shift_start":         shift_start_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_end":           shift_end_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "current_shift_consumption_kwh": round(current_shift_consumption_total, 2) if has_current_shift_data else None,
        "selected_total_kwh":          selected_total_kwh,
        "has_shift_window_data":       len(bars) > 0,
        "bars":                        bars,
        "members":                     members_breakdown,
    }


@router.get("/api/group_live_kpis")
def group_live_kpis(request: Request, group_id: int = None):
    require_login(request)
    if not group_id:
        raise HTTPException(status_code=400, detail="group_id is required")

    result = get_group_live_kpis(group_id)
    if not result:
        raise HTTPException(status_code=404, detail="Group not found")
    return result


def _parse_group_ids(group_ids: str) -> list:
    if not group_ids:
        return []
    ids = []
    for part in group_ids.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            pass
    return ids[:6]


@router.get("/api/groups/compare_live")
def groups_compare_live(request: Request, group_ids: str = ""):
    require_login(request)
    ids = _parse_group_ids(group_ids)
    if len(ids) < 2:
        raise HTTPException(status_code=400, detail="Select at least 2 groups to compare")
    return {"groups": compare_groups_live(ids)}


@router.get("/api/groups/compare")
def groups_compare_period(
    request: Request,
    group_ids: str = "",
    from_dt: str = None,
    to_dt: str = None,
):
    require_login(request)
    ids = _parse_group_ids(group_ids)
    if len(ids) < 2:
        raise HTTPException(status_code=400, detail="Select at least 2 groups to compare")
    if not from_dt or not to_dt:
        raise HTTPException(status_code=400, detail="from_dt and to_dt are required")
    try:
        from_parsed = datetime.fromisoformat(from_dt)
        to_parsed = datetime.fromisoformat(to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")
    if to_parsed <= from_parsed:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")
    return {
        "from_dt": from_parsed.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt": to_parsed.strftime("%Y-%m-%d %H:%M:%S"),
        "groups": compare_groups_period(ids, from_parsed, to_parsed),
    }

# ══════════════════════════════════════════════════════════════════════════════
# /incomer_shift_summary
# ══════════════════════════════════════════════════════════════════════════════

INCOMER_PARAMETERS = [
    ("Line Voltage",            "line_voltage",         "V"),
    ("Line-to-Line Voltage",    "line_to_line_voltage", "V"),
    ("Average Voltage",         "avg_voltage",          "V"),
    ("Voltage Unbalance",       "voltage_unbalance",    "%"),
    ("Line Current",            "line_current",         "A"),
    ("Phase-wise Current L1",   "current_l1",           "A"),
    ("Phase-wise Current L2",   "current_l2",           "A"),
    ("Phase-wise Current L3",   "current_l3",           "A"),
    ("Average Current",         "avg_current",          "A"),
    ("Neutral Line Current",    "neutral_line_current", "A"),
    ("Active Power kW L1",      "kw_l1",                "kW"),
    ("Active Power kW L2",      "kw_l2",                "kW"),
    ("Active Power kW L3",      "kw_l3",                "kW"),
    ("Cumulative kW",           "kw_total",             "kW"),
    ("Apparent Power kVA L1",   "kva_l1",               "kVA"),
    ("Apparent Power kVA L2",   "kva_l2",               "kVA"),
    ("Apparent Power kVA L3",   "kva_l3",               "kVA"),
    ("Cumulative kVA",          "kva_total",            "kVA"),
    ("Power Factor",            "pf",                   ""),
    ("Frequency",               "freq",                 "Hz"),
    ("kVA Maximum Demand",      "kva_max_demand",       "kVA"),
]


@router.get("/api/incomer_shift_summary")
def incomer_shift_summary(
    plant: str = None,
    meter: str = None,
    shift: str = "all",
    from_dt: str = None,
    to_dt: str = None,
):
    selected_shift = shift

    if not plant or not meter or not from_dt or not to_dt:
        raise HTTPException(status_code=400, detail="plant, meter, from_dt and to_dt are required")

    try:
        from_dt = datetime.fromisoformat(from_dt)
        to_dt   = datetime.fromisoformat(to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")

    if to_dt <= from_dt:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    meter_config = get_meter_config(plant, str(meter))
    if not meter_config:
        raise HTTPException(status_code=404, detail="Meter not found")
    if meter_config.get("type") != "incomer":
        raise HTTPException(status_code=400, detail="This endpoint is only for incomer meters")

    conn = get_db_connection()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    windows = get_shift_windows(from_dt, to_dt)
    if selected_shift != "all":
        windows = [w for w in windows if w[2].startswith(selected_shift)]

    series: list = []

    # Energy (kWh)
    kwh_day_buckets: dict = {}
    for window_start, window_end, _ in windows:
        w_start_row, w_end_row = fetch_value_bounds_in_window(
            cur, plant, int(meter), window_start, window_end, "kwh"
        )
        if not w_start_row or not w_end_row:
            continue
        cons    = round(max(0, float(w_end_row["val"]) - float(w_start_row["val"])), 2)
        day_key = get_production_day_key(window_start)
        kwh_day_buckets[day_key] = kwh_day_buckets.get(day_key, 0) + cons

    kwh_bars = [
        {"label": k, "value": round(v, 2)}
        for k, v in sorted(kwh_day_buckets.items())
    ]
    if kwh_bars:
        series.append({"label": "Energy Consumption", "unit": "kWh", "bars": kwh_bars})

    # All other parameters (averaged per day)
    for label, column, unit in INCOMER_PARAMETERS:
        day_buckets: dict = {}
        day_counts:  dict = {}
        for window_start, window_end, _ in windows:
            avg_row = fetch_avg_value_in_window(cur, plant, int(meter), window_start, window_end, column)
            if not avg_row or avg_row["avg_val"] is None:
                continue
            day_key = get_production_day_key(window_start)
            day_buckets[day_key] = day_buckets.get(day_key, 0.0) + float(avg_row["avg_val"])
            day_counts[day_key]  = day_counts.get(day_key, 0) + 1

        param_bars = [
            {"label": k, "value": round(day_buckets[k] / max(day_counts.get(k, 1), 1), 2)}
            for k in sorted(day_buckets.keys())
        ]
        if param_bars:
            series.append({"label": label, "unit": unit, "bars": param_bars})

    conn.close()
    return {
        "meter_id":       meter,
        "meter_name":     meter_config.get("name"),
        "meter_type":     "incomer",
        "selected_shift": selected_shift,
        "from_dt":        from_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "to_dt":          to_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "series":         series,
    }
