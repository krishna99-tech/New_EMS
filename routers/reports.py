import os
import csv
import io
import base64
from datetime import datetime
from tempfile import NamedTemporaryFile
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List
from fastapi.templating import Jinja2Templates
from fpdf import FPDF
import psycopg2.extras

from config import BASE_DIR
from routers.auth import require_login, require_login_page, template_context
from services.analytics_service import get_report_consumption_summary

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

@router.get("/reports", response_class=HTMLResponse)
def reports_page(request: Request):
    """Serve the Reports UI page."""
    redirect = require_login_page(request)
    if redirect:
        return redirect
    return templates.TemplateResponse("reports.html", template_context(request))

@router.get("/api/reports/download")
def download_report(request: Request, plant: str, start_date: str, end_date: str):
    """
    Generate and download a PDF report of energy consumption 
    for a specific plant over a given date range.
    """
    require_login(request)
    if not plant or not start_date or not end_date:
        raise HTTPException(status_code=400, detail="Missing parameters (plant, start_date, end_date)")

    # Append time to the dates if they are just YYYY-MM-DD
    if len(start_date) == 10:
        start_date += " 00:00:00"
    if len(end_date) == 10:
        end_date += " 23:59:59"

    rows = get_report_consumption_summary(plant, start_date, end_date)

    # Create PDF using fpdf2
    pdf = FPDF()
    pdf.add_page()
    
    # Title
    pdf.set_font("helvetica", size=18, style='B')
    pdf.set_text_color(6, 78, 59) # Dark Green Theme matching (#064e3b)
    pdf.cell(0, 10, text=f"Energy Consumption Report", ln=1, align='C')
    
    pdf.set_font("helvetica", size=14, style='B')
    pdf.set_text_color(50, 50, 50)
    pdf.cell(0, 8, text=f"Plant: {plant}", ln=1, align='C')
    
    # Period
    pdf.set_font("helvetica", size=11)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 8, text=f"Period: {start_date} to {end_date}", ln=1, align='C')
    pdf.ln(10)
    
    # Table Header
    pdf.set_fill_color(16, 185, 129) # #10b981
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", size=12, style='B')
    
    pdf.cell(80, 10, "Meter Name", border=1, fill=True)
    pdf.cell(45, 10, "Type", border=1, fill=True)
    pdf.cell(65, 10, "Consumption (kWh)", border=1, fill=True, ln=1)

    # Table Body
    pdf.set_text_color(50, 50, 50)
    pdf.set_font("helvetica", size=11)
    
    total_consumption = 0.0
    fill = False
    pdf.set_fill_color(240, 253, 244) # Very light green for alternating rows
    
    if not rows:
        pdf.cell(190, 10, "No data available for the selected period.", border=1, align='C', ln=1)
    else:
        for row in rows:
            s_kwh = row['start_kwh'] or 0
            e_kwh = row['end_kwh'] or 0
            consumption = float(e_kwh) - float(s_kwh)
            
            # Avoid negative consumption if reset happens
            if consumption < 0:
                consumption = float(e_kwh)
                
            if row['meter_type'] != 'incomer':
                total_consumption += consumption
                
            m_type = str(row['meter_type']).capitalize()
            
            pdf.cell(80, 10, str(row['meter_name']), border=1, fill=fill)
            pdf.cell(45, 10, m_type, border=1, fill=fill)
            pdf.cell(65, 10, f"{consumption:.2f}", border=1, align='R', fill=fill, ln=1)
            fill = not fill

    pdf.ln(10)
    
    # Summary
    pdf.set_font("helvetica", size=14, style='B')
    pdf.set_text_color(6, 78, 59)
    pdf.cell(0, 10, text=f"Total Submeter Consumption: {total_consumption:.2f} kWh", ln=1)

    # Output to temporary file
    temp_file = NamedTemporaryFile(delete=False, suffix=".pdf")
    temp_file.close() # Close so FPDF can write to it
    
    pdf.output(temp_file.name)
    
    return FileResponse(
        temp_file.name, 
        media_type="application/pdf", 
        filename=f"{plant}_Energy_Report.pdf",
        background=None
    )


@router.get("/api/reports/download_csv")
def download_report_csv(request: Request, plant: str, start_date: str, end_date: str):
    """
    Generate and download a CSV report of energy consumption 
    for a specific plant over a given date range.
    """
    require_login(request)
    if not plant or not start_date or not end_date:
        raise HTTPException(status_code=400, detail="Missing parameters (plant, start_date, end_date)")

    # Append time to the dates if they are just YYYY-MM-DD
    if len(start_date) == 10:
        start_date += " 00:00:00"
    if len(end_date) == 10:
        end_date += " 23:59:59"

    rows = get_report_consumption_summary(plant, start_date, end_date)

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write header
    writer.writerow(["Meter Name", "Type", "Consumption (kWh)"])

    total_consumption = 0.0
    for row in rows:
        s_kwh = row['start_kwh'] or 0
        e_kwh = row['end_kwh'] or 0
        consumption = float(e_kwh) - float(s_kwh)
        
        # Avoid negative consumption if reset happens
        if consumption < 0:
            consumption = float(e_kwh)
            
        if row['meter_type'] != 'incomer':
            total_consumption += consumption
            
        m_type = str(row['meter_type']).capitalize()
        writer.writerow([str(row['meter_name']), m_type, f"{consumption:.2f}"])

    # Write summary footer
    writer.writerow([])
    writer.writerow(["Total Submeter Consumption (kWh)", "", f"{total_consumption:.2f}"])

    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]), 
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={plant}_Energy_Report.csv"}
    )


class ChartDataPoint(BaseModel):
    label: str
    value: float

class ChartPdfRequest(BaseModel):
    group_name: str
    location: str = "Unassigned"
    shift: str = "All Shifts"
    meters_included: List[str] = []
    start_date: str
    end_date: str
    chart_image: str  # Base64 string
    data_points: List[ChartDataPoint]

@router.post("/api/reports/download_group_chart_pdf")
def download_group_chart_pdf(request: Request, payload: ChartPdfRequest):
    """
    Accepts a base64 encoded chart image and data points,
    and returns a beautifully formatted PDF report.
    """
    require_login(request)

    # Decode base64 image
    img_data = payload.chart_image.split(",")[1] if "," in payload.chart_image else payload.chart_image
    img_bytes = base64.b64decode(img_data)
    
    with NamedTemporaryFile(delete=False, suffix=".png") as img_file:
        img_file.write(img_bytes)
        img_path = img_file.name

    try:
        pdf = FPDF(orientation='L') # Landscape for better chart viewing
        pdf.add_page()
        
        # ── Header ──
        pdf.set_font("helvetica", size=22, style='B')
        pdf.set_text_color(6, 78, 59)
        pdf.cell(0, 10, text="Fuso Energy Management System", ln=1, align='L')
        
        pdf.set_font("helvetica", size=14, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(0, 8, text="Energy Consumption Analytics Report", ln=1, align='L')
        
        # Generation time
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.set_font("helvetica", size=9)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 6, text=f"Generated On: {now_str}", ln=1, align='L')
        pdf.ln(5)

        # ── Report Parameters Box ──
        pdf.set_fill_color(248, 250, 252) # Very light gray/blue
        pdf.set_draw_color(203, 213, 225) # Slate border
        
        # Calculate total consumption
        total_consumption = sum(pt.value for pt in payload.data_points)

        # Background box for details
        pdf.rect(10, pdf.get_y(), 277, 36, style='DF')
        pdf.set_y(pdf.get_y() + 4)
        
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)
        
        # Row 1
        pdf.set_x(14)
        pdf.cell(25, 7, "Location:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(75, 7, payload.location)
        
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Group Name:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(65, 7, payload.group_name)
        
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(15, 7, "Shift:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(50, 7, payload.shift, ln=1)
        
        # Row 2
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Date Range:")
        pdf.set_font("helvetica", size=10)
        # Format the dates slightly cleaner
        start_short = payload.start_date.replace(":00:00", "") if payload.start_date else ""
        end_short = payload.end_date.replace(":00:00", "") if payload.end_date else ""
        period_text = f"{start_short} to {end_short}" if (start_short and end_short) else (start_short or "Custom")
        pdf.cell(75, 7, period_text)
        
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(32, 7, "Meters Included:")
        pdf.set_font("helvetica", size=9)
        meters_str = ", ".join(payload.meters_included)
        if len(meters_str) > 80:
            meters_str = meters_str[:77] + "..."
        pdf.cell(100, 7, meters_str, ln=1)

        # Row 3
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(40, 7, "Total Consumption:")
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(16, 185, 129) # Highlight in green
        pdf.cell(50, 7, f"{total_consumption:.2f} kWh", ln=1)
        
        # Move past the box (box started at ~39 + 36 = 75)
        pdf.set_y(80)
        
        # ── Insert Chart Image ──
        # Center the chart horizontally and constrain height to fit gracefully on ONE page
        pdf.image(img_path, x='C', w=270, h=110, keep_aspect_ratio=True)
        
        temp_pdf = NamedTemporaryFile(delete=False, suffix=".pdf")
        temp_pdf.close()
        pdf.output(temp_pdf.name)

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)
            
    safe_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    return FileResponse(
        temp_pdf.name, 
        media_type="application/pdf", 
        filename=f"{payload.group_name}_Chart_Report_{safe_time}.pdf",
        background=None
    )


# ── Plant-specific chart PDF ───────────────────────────────────────────────────

class PlantChartPdfRequest(BaseModel):
    meter_name: str
    plant_name: str = "Plant"
    location: str = ""
    shift: str = "All Shifts"
    start_date: str = ""
    end_date: str = ""
    chart_image: str   # Base64 string (data:image/png;base64,...)
    data_points: List[ChartDataPoint]

@router.post("/api/reports/download_plant_chart_pdf")
def download_plant_chart_pdf(request: Request, payload: PlantChartPdfRequest):
    """
    Accepts a base64-encoded screenshot of the plant CSS bar chart (via html2canvas)
    or an ECharts image, and returns a professional single-meter PDF report.
    No login required — plant dashboard is publicly accessible.
    """

    # Decode base64 image
    img_data = payload.chart_image.split(",")[1] if "," in payload.chart_image else payload.chart_image
    img_bytes = base64.b64decode(img_data)

    with NamedTemporaryFile(delete=False, suffix=".png") as img_file:
        img_file.write(img_bytes)
        img_path = img_file.name

    def sanitize(text: str) -> str:
        """Strip characters outside Latin-1 range (e.g. ● live-status bullets)."""
        return text.encode("latin-1", errors="ignore").decode("latin-1").strip()

    plant_name_clean = sanitize(payload.plant_name)
    meter_name_clean = sanitize(payload.meter_name)
    shift_clean      = sanitize(payload.shift)
    location_clean   = sanitize(payload.location) if payload.location else ""

    try:

        pdf = FPDF(orientation='L')  # Landscape
        pdf.add_page()

        # ── Header ──
        pdf.set_font("helvetica", size=22, style='B')
        pdf.set_text_color(6, 78, 59)
        pdf.cell(0, 10, text="Fuso Energy Management System", ln=1, align='L')

        pdf.set_font("helvetica", size=14, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(0, 8, text="Meter Analysis Report", ln=1, align='L')

        # Generation time
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.set_font("helvetica", size=9)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 6, text=f"Generated On: {now_str}", ln=1, align='L')
        pdf.ln(5)

        # ── Report Parameters Box ──
        pdf.set_fill_color(248, 250, 252)
        pdf.set_draw_color(203, 213, 225)

        total_consumption = sum(pt.value for pt in payload.data_points)

        pdf.rect(10, pdf.get_y(), 277, 50, style='DF')  # taller box for 4 rows
        pdf.set_y(pdf.get_y() + 4)

        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)

        # Row 1: Plant Name | Meter Name | Shift
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
        pdf.cell(50, 7, shift_clean, ln=1)

        # Row 2: Location | Date Range
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(25, 7, "Location:")
        pdf.set_font("helvetica", size=10)
        pdf.cell(75, 7, location_clean or "N/A")

        pdf.set_font("helvetica", size=10, style='B')
        pdf.cell(25, 7, "Date Range:")
        pdf.set_font("helvetica", size=10)
        start_short = payload.start_date.replace(":00:00", "") if payload.start_date else ""
        end_short = payload.end_date.replace(":00:00", "") if payload.end_date else ""
        period_text = f"{start_short} to {end_short}" if (start_short and end_short) else (start_short or "Custom")
        pdf.cell(100, 7, period_text, ln=1)

        # Row 3: Total Consumption (highlighted green, own line)
        pdf.set_x(14)
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(50, 50, 50)
        pdf.cell(40, 7, "Total Consumption:")
        pdf.set_font("helvetica", size=10, style='B')
        pdf.set_text_color(16, 185, 129)  # green highlight
        pdf.cell(50, 7, f"{total_consumption:.2f} kWh", ln=1)


        # Move past the box (4 rows * 7px + 8px header padding + 10px margin ≈ 88)
        pdf.set_y(88)

        # ── Insert Chart Image ──
        pdf.image(img_path, x='C', w=270, h=95, keep_aspect_ratio=True)

        temp_pdf = NamedTemporaryFile(delete=False, suffix=".pdf")
        temp_pdf.close()
        pdf.output(temp_pdf.name)

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)

    safe_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_meter = meter_name_clean.replace(" ", "_")
    return FileResponse(
        temp_pdf.name,
        media_type="application/pdf",
        filename=f"{safe_meter}_Analysis_{safe_time}.pdf",
        background=None
    )

