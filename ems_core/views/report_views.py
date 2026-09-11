"""
ems_core/views/report_views.py — Reports UI and PDF/CSV chart report generation.
"""

import os
import csv
import io
import base64
from datetime import datetime
from tempfile import NamedTemporaryFile
from django.http import HttpResponse, FileResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from fpdf import FPDF

from services.analytics_service import get_report_consumption_summary
from ems_core.views.utils import login_required_page, login_required_api, parse_json


@login_required_page
def reports_page(request):
    """Serve the Reports UI page."""
    return render(request, "reports.html")


@login_required_api
def download_report(request):
    """
    Generate and download a PDF report of energy consumption 
    for a specific plant over a given date range.
    """
    plant = request.GET.get("plant")
    start_date = request.GET.get("start_date")
    end_date = request.GET.get("end_date")

    if not plant or not start_date or not end_date:
        return JsonResponse({"detail": "Missing parameters (plant, start_date, end_date)"}, status=400)

    if len(start_date) == 10:
        start_date += " 00:00:00"
    if len(end_date) == 10:
        end_date += " 23:59:59"

    rows = get_report_consumption_summary(plant, start_date, end_date)

    pdf = FPDF()
    pdf.add_page()

    # Title
    pdf.set_font("helvetica", size=18, style='B')
    pdf.set_text_color(6, 78, 59)
    pdf.cell(0, 10, text="Energy Consumption Report", align='C')
    pdf.ln(10)

    pdf.set_font("helvetica", size=14, style='B')
    pdf.set_text_color(50, 50, 50)
    pdf.cell(0, 8, text=f"Plant: {plant}", align='C')
    pdf.ln(8)

    # Period
    pdf.set_font("helvetica", size=11)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 8, text=f"Period: {start_date} to {end_date}", align='C')
    pdf.ln(10)

    # Table Header
    pdf.set_fill_color(16, 185, 129)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", size=12, style='B')

    pdf.cell(80, 10, "Meter Name", border=1, fill=True)
    pdf.cell(45, 10, "Type", border=1, fill=True)
    pdf.cell(65, 10, "Consumption (kWh)", border=1, fill=True)
    pdf.ln(10)

    # Table Body
    pdf.set_text_color(50, 50, 50)
    pdf.set_font("helvetica", size=11)

    total_consumption = 0.0
    fill = False
    pdf.set_fill_color(240, 253, 244)

    if not rows:
        pdf.cell(190, 10, "No data available for the selected period.", border=1, align='C')
        pdf.ln(10)
    else:
        for row in rows:
            s_kwh = row['start_kwh'] or 0
            e_kwh = row['end_kwh'] or 0
            consumption = float(e_kwh) - float(s_kwh)

            if consumption < 0:
                consumption = float(e_kwh)

            if row['meter_type'] != 'incomer':
                total_consumption += consumption

            m_type = str(row['meter_type']).capitalize()

            pdf.cell(80, 10, str(row['meter_name']), border=1, fill=fill)
            pdf.cell(45, 10, m_type, border=1, fill=fill)
            pdf.cell(65, 10, f"{consumption:.2f}", border=1, align='R', fill=fill)
            pdf.ln(10)
            fill = not fill

    pdf.ln(10)

    pdf.set_font("helvetica", size=14, style='B')
    pdf.set_text_color(6, 78, 59)
    pdf.cell(0, 10, text=f"Total Submeter Consumption: {total_consumption:.2f} kWh")
    pdf.ln(10)

    pdf_bytes = bytes(pdf.output())
    resp = HttpResponse(pdf_bytes, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{plant}_Energy_Report.pdf"'
    return resp


@login_required_api
def download_report_csv(request):
    plant = request.GET.get("plant")
    start_date = request.GET.get("start_date")
    end_date = request.GET.get("end_date")

    if not plant or not start_date or not end_date:
        return JsonResponse({"detail": "Missing parameters (plant, start_date, end_date)"}, status=400)

    if len(start_date) == 10:
        start_date += " 00:00:00"
    if len(end_date) == 10:
        end_date += " 23:59:59"

    rows = get_report_consumption_summary(plant, start_date, end_date)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Meter Name", "Type", "Consumption (kWh)"])

    total_consumption = 0.0
    for row in rows:
        s_kwh = row['start_kwh'] or 0
        e_kwh = row['end_kwh'] or 0
        consumption = float(e_kwh) - float(s_kwh)

        if consumption < 0:
            consumption = float(e_kwh)

        if row['meter_type'] != 'incomer':
            total_consumption += consumption

        m_type = str(row['meter_type']).capitalize()
        writer.writerow([str(row['meter_name']), m_type, f"{consumption:.2f}"])

    writer.writerow([])
    writer.writerow(["Total Submeter Consumption (kWh)", "", f"{total_consumption:.2f}"])

    csv_data = output.getvalue()
    output.close()

    resp = HttpResponse(csv_data, content_type="text/csv")
    resp["Content-Disposition"] = f'attachment; filename="{plant}_Energy_Report.csv"'
    return resp


@csrf_exempt
@login_required_api
def download_group_chart_pdf(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    data = parse_json(request)
    group_name = data.get("group_name", "Group")
    location = data.get("location", "Unassigned")
    shift = data.get("shift", "All Shifts")
    meters_included = data.get("meters_included", [])
    start_date = data.get("start_date", "")
    end_date = data.get("end_date", "")
    chart_image = data.get("chart_image", "")
    data_points = data.get("data_points", [])

    img_data = chart_image.split(",")[1] if "," in chart_image else chart_image
    img_bytes = base64.b64decode(img_data)

    with NamedTemporaryFile(delete=False, suffix=".png") as img_file:
        img_file.write(img_bytes)
        img_path = img_file.name

    try:
        pdf = FPDF(orientation='L')
        pdf.add_page()

        pdf.set_font("helvetica", size=22, style='B')
        pdf.set_text_color(6, 78, 59)
        pdf.cell(0, 10, text="Fuso Energy Management System", align='L')
        pdf.ln(10)

        pdf.set_font("helvetica", size=14, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(0, 8, text="Energy Consumption Analytics Report", align='L')
        pdf.ln(8)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.set_font("helvetica", size=9)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 6, text=f"Generated On: {now_str}", align='L')
        pdf.ln(11)

        pdf.set_fill_color(248, 250, 252)
        pdf.set_draw_color(203, 213, 225)

        total_consumption = sum(float(pt.get("value", 0)) for pt in data_points)

        pdf.rect(10, pdf.get_y(), 277, 36, style='DF')
        pdf.set_y(pdf.get_y() + 4)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)

        # Row 1
        pdf.set_x(14)
        pdf.cell(25, 7, "Location:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(75, 7, location)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Group Name:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(65, 7, group_name)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(15, 7, "Shift:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(50, 7, shift)
        pdf.ln(7)

        # Row 2
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Date Range:")
        pdf.set_font("helvetica", size=10)
        start_short = start_date.replace(":00:00", "") if start_date else ""
        end_short = end_date.replace(":00:00", "") if end_date else ""
        period_text = f"{start_short} to {end_short}" if (start_short and end_short) else (start_short or "Custom")
        pdf.cell(75, 7, period_text)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(32, 7, "Meters Included:")
        pdf.set_font("helvetica", size=9)
        meters_str = ", ".join(meters_included)
        if len(meters_str) > 80:
            meters_str = meters_str[:77] + "..."
        pdf.cell(100, 7, meters_str)
        pdf.ln(7)

        # Row 3
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(40, 7, "Total Consumption:")
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(16, 185, 129)
        pdf.cell(50, 7, f"{total_consumption:.2f} kWh")
        pdf.ln(7)

        pdf.set_y(80)
        pdf.image(img_path, x='C', w=270, h=110, keep_aspect_ratio=True)

        pdf_bytes = bytes(pdf.output())

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)

    safe_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    resp = HttpResponse(pdf_bytes, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{group_name}_Chart_Report_{safe_time}.pdf"'
    return resp


@csrf_exempt
def download_plant_chart_pdf(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    data = parse_json(request)
    meter_name = data.get("meter_name", "Meter")
    plant_name = data.get("plant_name", "Plant")
    location = data.get("location", "")
    shift = data.get("shift", "All Shifts")
    start_date = data.get("start_date", "")
    end_date = data.get("end_date", "")
    chart_image = data.get("chart_image", "")
    data_points = data.get("data_points", [])

    img_data = chart_image.split(",")[1] if "," in chart_image else chart_image
    img_bytes = base64.b64decode(img_data)

    with NamedTemporaryFile(delete=False, suffix=".png") as img_file:
        img_file.write(img_bytes)
        img_path = img_file.name

    def sanitize(text: str) -> str:
        return str(text).encode("latin-1", errors="ignore").decode("latin-1").strip()

    plant_name_clean = sanitize(plant_name)
    meter_name_clean = sanitize(meter_name)
    shift_clean      = sanitize(shift)
    location_clean   = sanitize(location) if location else ""

    try:
        pdf = FPDF(orientation='L')
        pdf.add_page()

        pdf.set_font("helvetica", size=22, style='B')
        pdf.set_text_color(6, 78, 59)
        pdf.cell(0, 10, text="Fuso Energy Management System", align='L')
        pdf.ln(10)

        pdf.set_font("helvetica", size=14, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(0, 8, text="Meter Analysis Report", align='L')
        pdf.ln(8)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.set_font("helvetica", size=9)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 6, text=f"Generated On: {now_str}", align='L')
        pdf.ln(11)

        pdf.set_fill_color(248, 250, 252)
        pdf.set_draw_color(203, 213, 225)

        total_consumption = sum(float(pt.get("value", 0)) for pt in data_points)

        pdf.rect(10, pdf.get_y(), 277, 50, style='DF')
        pdf.set_y(pdf.get_y() + 4)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)

        # Row 1
        pdf.set_x(14)
        pdf.cell(25, 7, "Plant Name:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(75, 7, plant_name_clean)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Meter Name:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(65, 7, meter_name_clean)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(15, 7, "Shift:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(50, 7, shift_clean)
        pdf.ln(7)

        # Row 2
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Location:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(75, 7, location_clean or "N/A")

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Date Range:")
        pdf.set_font("helvetica", size=10)
        start_short = start_date.replace(":00:00", "") if start_date else ""
        end_short = end_date.replace(":00:00", "") if end_date else ""
        period_text = f"{start_short} to {end_short}" if (start_short and end_short) else (start_short or "Custom")
        pdf.cell(100, 7, period_text)
        pdf.ln(7)

        # Row 3
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(40, 7, "Total Consumption:")
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(16, 185, 129)
        pdf.cell(50, 7, f"{total_consumption:.2f} kWh")
        pdf.ln(7)

        pdf.set_y(88)
        pdf.image(img_path, x='C', w=270, h=95, keep_aspect_ratio=True)

        pdf_bytes = bytes(pdf.output())

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)

    safe_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_meter = meter_name_clean.replace(" ", "_")
    resp = HttpResponse(pdf_bytes, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{safe_meter}_Analysis_{safe_time}.pdf"'
    return resp
