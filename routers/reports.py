import os
from tempfile import NamedTemporaryFile
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
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
