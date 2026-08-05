"""
routers/export.py — CSV and PDF export routes.

Route:
  GET /export_csv
  GET /export_group_csv
  GET /export_group_pdf
"""

import csv
import io
from datetime import datetime, timedelta
from tempfile import NamedTemporaryFile

import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fpdf import FPDF

from database import get_db_connection
from helpers import (
    fetch_avg_value_in_window,
    fetch_latest_value_at_or_before,
    fetch_value_bounds_in_window,
    get_all_meters,
    get_meter_config,
    get_production_day_key,
    get_shift_start,
    get_shift_windows,
)
from services.analytics_service import get_raw_meter_data
from services import group_service
from services.group_analytics_service import get_member_breakdown
from routers.auth import require_login

router = APIRouter()


@router.get("/export_csv")
def export_csv(
    plant: str = None,
    meter: str = None,
    from_dt: str = None,
    to_dt: str = None,
    shift_analysis: str = "false",
    shift: str = "all",
):
    selected_shift        = shift
    shift_analysis_enabled = str(shift_analysis).strip().lower() in ("1", "true", "yes", "on")

    if not plant or not meter or not from_dt or not to_dt:
        raise HTTPException(status_code=400, detail="plant, meter, from_dt and to_dt are required")

    try:
        from_dt = datetime.fromisoformat(from_dt)
        to_dt   = datetime.fromisoformat(to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")

    if to_dt <= from_dt:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    conn = get_db_connection()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    output = io.StringIO()
    writer = csv.writer(output)

    # ── Shared helpers ─────────────────────────────────────────────────────────

    def get_windows_for_export():
        windows = get_shift_windows(from_dt, to_dt)
        if selected_shift != "all":
            windows = [w for w in windows if w[2].startswith(selected_shift)]
        return windows

    def get_submeter_consumption_for_windows(meter_id, windows):
        total = 0.0
        for window_start, window_end, _ in windows:
            w_start_row, w_end_row = fetch_value_bounds_in_window(
                cur, plant, meter_id, window_start, window_end, "kwh"
            )
            if not w_start_row or not w_end_row:
                continue
            total += max(0.0, float(w_end_row["val"]) - float(w_start_row["val"]))
        return round(total, 2)

    def get_production_day_floor(dt: datetime) -> datetime:
        day_6am = datetime.combine(dt.date(), datetime.min.time()).replace(hour=6)
        if dt < day_6am:
            day_6am -= timedelta(days=1)
        return day_6am

    def get_submeter_daily_rows(meter_id):
        rows   = []
        cursor = get_production_day_floor(from_dt)
        while cursor < to_dt:
            day_start    = cursor
            day_end      = day_start + timedelta(days=1)
            window_start = max(day_start, from_dt)
            window_end   = min(day_end, to_dt)
            if window_end <= window_start:
                cursor = day_end
                continue
            w_start_row, w_end_row = fetch_value_bounds_in_window(
                cur, plant, meter_id, window_start, window_end, "kwh"
            )
            if w_start_row and w_end_row:
                start_kwh = float(w_start_row["val"])
                end_kwh   = float(w_end_row["val"])
                rows.append({
                    "production_day":  day_start.strftime("%Y-%m-%d"),
                    "window_start":    window_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "window_end":      window_end.strftime("%Y-%m-%d %H:%M:%S"),
                    "start_kwh":       round(start_kwh, 2),
                    "end_kwh":         round(end_kwh, 2),
                    "consumption_kwh": round(max(0.0, end_kwh - start_kwh), 2),
                })
            cursor = day_end
        return rows

    # ── Branch: all submeters ──────────────────────────────────────────────────

    if meter == "all":
        submeters = [
            (mid, meta.get("name", f"Meter {mid}"))
            for mid, meta in get_all_meters(plant).items()
            if meta.get("type", "submeter") == "submeter"
        ]

        if shift_analysis_enabled:
            windows = get_windows_for_export()
            writer.writerow(["Plant", "Meter_ID", "Meter_Name", "Shift_Filter", "From_DT", "To_DT", "Consumption_KWH"])
        else:
            writer.writerow(["Plant", "Meter_ID", "Meter_Name", "From_DT", "To_DT", "Start_KWH", "End_KWH", "Consumption_KWH"])

        grand_total = 0.0
        for meter_id, meter_name in submeters:
            if shift_analysis_enabled:
                consumption  = get_submeter_consumption_for_windows(meter_id, windows)
                grand_total += consumption
                writer.writerow([
                    plant, meter_id, meter_name, selected_shift,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    consumption,
                ])
            else:
                start_row   = fetch_latest_value_at_or_before(cur, plant, meter_id, from_dt, "kwh")
                end_row     = fetch_latest_value_at_or_before(cur, plant, meter_id, to_dt,   "kwh")
                start_kwh   = float(start_row["val"]) if start_row and start_row["val"] is not None else None
                end_kwh     = float(end_row["val"])   if end_row   and end_row["val"]   is not None else None
                consumption = round(max(0.0, end_kwh - start_kwh), 2) if start_kwh is not None and end_kwh is not None else None
                if consumption is not None:
                    grand_total += consumption
                writer.writerow([
                    plant, meter_id, meter_name,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    round(start_kwh, 2) if start_kwh is not None else "",
                    round(end_kwh,   2) if end_kwh   is not None else "",
                    consumption if consumption is not None else "",
                ])

        writer.writerow([])
        if shift_analysis_enabled:
            writer.writerow(["Plant", "Shift_Filter", "From_DT", "To_DT", "Total_Submeters_Consumption_KWH"])
            writer.writerow([plant, selected_shift, from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"), round(grand_total, 2)])
        else:
            writer.writerow(["Plant", "From_DT", "To_DT", "Total_Submeters_Consumption_KWH"])
            writer.writerow([plant, from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"), round(grand_total, 2)])

        mode_label = "shiftwise" if shift_analysis_enabled else "rangewise"
        filename   = f"{plant}_all_submeters_total_kwh_{mode_label}_{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"

    # ── Branch: single meter ───────────────────────────────────────────────────

    else:
        try:
            meter_id = int(meter)
        except ValueError:
            conn.close()
            raise HTTPException(status_code=400, detail="Invalid meter id")

        meter_cfg  = get_meter_config(plant, str(meter_id))
        meter_type = meter_cfg.get("type", "submeter")

        if meter_type == "submeter":
            if shift_analysis_enabled:
                windows = get_windows_for_export()
                writer.writerow([
                    "Plant", "Meter_ID", "Meter_Name", "Shift_Name",
                    "Window_Start", "Window_End", "Start_KWH", "End_KWH", "Consumption_KWH",
                ])
                total = 0.0
                for window_start, window_end, shift_name in windows:
                    w_start_row, w_end_row = fetch_value_bounds_in_window(
                        cur, plant, meter_id, window_start, window_end, "kwh"
                    )
                    if not w_start_row or not w_end_row:
                        continue
                    start_kwh   = float(w_start_row["val"])
                    end_kwh     = float(w_end_row["val"])
                    consumption = round(max(0.0, end_kwh - start_kwh), 2)
                    total      += consumption
                    writer.writerow([
                        plant, meter_id, meter_cfg.get("name", f"Meter {meter_id}"), shift_name,
                        window_start.strftime("%Y-%m-%d %H:%M:%S"), window_end.strftime("%Y-%m-%d %H:%M:%S"),
                        round(start_kwh, 2), round(end_kwh, 2), consumption,
                    ])
                writer.writerow([])
                writer.writerow(["Plant", "Meter_ID", "Meter_Name", "Shift_Filter", "From_DT", "To_DT", "Total_Consumption_KWH"])
                writer.writerow([
                    plant, meter_id, meter_cfg.get("name", f"Meter {meter_id}"), selected_shift,
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"), round(total, 2),
                ])
            else:
                start_row   = fetch_latest_value_at_or_before(cur, plant, meter_id, from_dt, "kwh")
                end_row     = fetch_latest_value_at_or_before(cur, plant, meter_id, to_dt,   "kwh")
                start_kwh   = float(start_row["val"]) if start_row and start_row["val"] is not None else None
                end_kwh     = float(end_row["val"])   if end_row   and end_row["val"]   is not None else None
                consumption = round(max(0.0, end_kwh - start_kwh), 2) if start_kwh is not None and end_kwh is not None else None
                writer.writerow(["Plant", "Meter_ID", "Meter_Name", "From_DT", "To_DT", "Start_KWH", "End_KWH", "Consumption_KWH"])
                writer.writerow([
                    plant, meter_id, meter_cfg.get("name", f"Meter {meter_id}"),
                    from_dt.strftime("%Y-%m-%d %H:%M:%S"), to_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    round(start_kwh, 2) if start_kwh is not None else "",
                    round(end_kwh,   2) if end_kwh   is not None else "",
                    consumption if consumption is not None else "",
                ])

            daily_rows = get_submeter_daily_rows(meter_id)
            if daily_rows:
                writer.writerow([])
                writer.writerow(["Production_Day", "Window_Start", "Window_End", "Start_KWH", "End_KWH", "Consumption_KWH"])
                for drow in daily_rows:
                    writer.writerow([
                        drow["production_day"], drow["window_start"], drow["window_end"],
                        drow["start_kwh"], drow["end_kwh"], drow["consumption_kwh"],
                    ])

            filename = (
                f"{plant}_submeter_{meter_id}_"
                f"{'shiftwise' if shift_analysis_enabled else 'rangewise'}_"
                f"{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"
            )

        else:  # incomer
            rows = get_raw_meter_data(
                plant, 
                meter_id, 
                from_dt.strftime("%Y-%m-%d %H:%M:%S"), 
                to_dt.strftime("%Y-%m-%d %H:%M:%S")
            )

            writer.writerow([
                "Timestamp", "Plant", "Meter_ID", "Meter_Name", "Meter_Type", "Status",
                "KWH", "KW", "KVA", "PF", "Volt", "Curr", "Freq",
                "Line_Voltage", "Line_To_Line_Voltage", "Avg_Voltage", "Voltage_Unbalance",
                "Line_Current", "Current_L1", "Current_L2", "Current_L3", "Avg_Current",
                "Neutral_Line_Current", "KW_L1", "KW_L2", "KW_L3", "KW_Total",
                "KVA_L1", "KVA_L2", "KVA_L3", "KVA_Total", "KVA_Max_Demand",
            ])
            for row in rows:
                writer.writerow([row[col] for col in row.keys()])

            filename = (
                f"{plant}_incomer_{meter_id}_"
                f"{from_dt.strftime('%Y%m%d_%H%M')}_to_{to_dt.strftime('%Y%m%d_%H%M')}.csv"
            )

    conn.close()
    csv_data = output.getvalue()
    output.close()

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export_group_csv")
def export_group_csv(
    request: Request,
    group_id: int = None,
    from_dt: str = None,
    to_dt: str = None,
    mode: str = "shiftwise",
    shift: str = "all",
):
    require_login(request)
    if not group_id or not from_dt or not to_dt:
        raise HTTPException(status_code=400, detail="group_id, from_dt and to_dt are required")

    try:
        from_dt_parsed = datetime.fromisoformat(from_dt)
        to_dt_parsed = datetime.fromisoformat(to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")

    if to_dt_parsed <= from_dt_parsed:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        raise HTTPException(status_code=404, detail="Group not found")

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Group", group_data["name"]])
    writer.writerow(["From", from_dt_parsed.strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["To", to_dt_parsed.strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow([])

    members = group_data["members"]
    breakdown = get_member_breakdown(cur, members, from_dt_parsed, to_dt_parsed)
    conn.close()

    writer.writerow(["Plant", "Meter ID", "Meter Name", "Start (kWh)", "End (kWh)", "Consumption (kWh)"])
    total = 0.0
    for row in breakdown:
        cons = row.get("consumption")
        if cons is not None:
            total += cons
        writer.writerow([
            row["plant"],
            row["meter_id"],
            row["meter_name"],
            row.get("start_kwh", ""),
            row.get("end_kwh", ""),
            cons if cons is not None else "",
        ])
    writer.writerow([])
    writer.writerow(["", "", "Group Total", "", "", round(total, 2)])

    safe_name = group_data["name"].replace(" ", "_")
    filename = f"group_{safe_name}_{from_dt_parsed.strftime('%Y%m%d_%H%M')}_to_{to_dt_parsed.strftime('%Y%m%d_%H%M')}.csv"
    csv_data = output.getvalue()
    output.close()

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export_group_pdf")
def export_group_pdf(
    request: Request,
    group_id: int = None,
    from_dt: str = None,
    to_dt: str = None,
):
    require_login(request)
    if not group_id or not from_dt or not to_dt:
        raise HTTPException(status_code=400, detail="group_id, from_dt and to_dt are required")

    try:
        from_dt_parsed = datetime.fromisoformat(from_dt)
        to_dt_parsed = datetime.fromisoformat(to_dt)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")

    if to_dt_parsed <= from_dt_parsed:
        raise HTTPException(status_code=400, detail="to_dt must be greater than from_dt")

    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        raise HTTPException(status_code=404, detail="Group not found")

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    breakdown = get_member_breakdown(cur, group_data["members"], from_dt_parsed, to_dt_parsed)
    conn.close()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=16, style="B")
    pdf.set_text_color(79, 70, 229)
    pdf.cell(0, 10, text="Group Energy Consumption Report", ln=1, align="C")

    pdf.set_font("helvetica", size=12, style="B")
    pdf.set_text_color(50, 50, 50)
    pdf.cell(0, 8, text=f"Group: {group_data['name']}", ln=1, align="C")

    pdf.set_font("helvetica", size=10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(
        0, 8,
        text=f"Period: {from_dt_parsed.strftime('%Y-%m-%d %H:%M')} to {to_dt_parsed.strftime('%Y-%m-%d %H:%M')}",
        ln=1, align="C",
    )
    pdf.ln(8)

    pdf.set_fill_color(79, 70, 229)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", size=10, style="B")
    pdf.cell(45, 9, "Plant", border=1, fill=True)
    pdf.cell(25, 9, "Meter", border=1, fill=True)
    pdf.cell(55, 9, "Name", border=1, fill=True)
    pdf.cell(30, 9, "Start kWh", border=1, fill=True)
    pdf.cell(30, 9, "End kWh", border=1, fill=True)
    pdf.cell(30, 9, "kWh Used", border=1, fill=True, ln=1)

    pdf.set_text_color(50, 50, 50)
    pdf.set_font("helvetica", size=9)
    total = 0.0
    fill = False
    pdf.set_fill_color(245, 245, 255)

    for row in breakdown:
        cons = row.get("consumption")
        if cons is not None:
            total += cons
        name = (row.get("meter_name") or "")[:28]
        pdf.cell(45, 8, str(row["plant"])[:20], border=1, fill=fill)
        pdf.cell(25, 8, str(row["meter_id"]), border=1, fill=fill)
        pdf.cell(55, 8, name, border=1, fill=fill)
        pdf.cell(30, 8, f"{row.get('start_kwh', '')}", border=1, fill=fill, align="R")
        pdf.cell(30, 8, f"{row.get('end_kwh', '')}", border=1, fill=fill, align="R")
        pdf.cell(30, 8, f"{cons if cons is not None else ''}", border=1, fill=fill, align="R", ln=1)
        fill = not fill

    pdf.ln(6)
    pdf.set_font("helvetica", size=12, style="B")
    pdf.set_text_color(79, 70, 229)
    pdf.cell(0, 10, text=f"Group Total: {round(total, 2)} kWh", ln=1)

    temp_file = NamedTemporaryFile(delete=False, suffix=".pdf")
    temp_file.close()
    pdf.output(temp_file.name)

    safe_name = group_data["name"].replace(" ", "_")
    return FileResponse(
        temp_file.name,
        media_type="application/pdf",
        filename=f"group_{safe_name}_{from_dt_parsed.strftime('%Y%m%d')}.pdf",
    )
