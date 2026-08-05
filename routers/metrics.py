from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
import psycopg2.extras
from database import get_db_connection

router = APIRouter(prefix="/metrics")

@router.get("/groups", response_class=PlainTextResponse)
def get_group_metrics():
    """
    Expose grouped energy data in Prometheus standard format.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Fetch the live view data directly from PostgreSQL
        cur.execute("SELECT * FROM vw_group_live_status")
        rows = cur.fetchall()
        
        lines = []
        
        # Define HELP and TYPE for kWh (counter)
        lines.append("# HELP ems_group_energy_kwh Total aggregated energy consumed by the group in kWh")
        lines.append("# TYPE ems_group_energy_kwh counter")
        for r in rows:
            group_id = r["group_id"]
            group_name = r["group_name"].replace('"', '\\"') if r["group_name"] else "Unknown"
            val = r["total_kwh"] if r["total_kwh"] is not None else 0.0
            lines.append(f'ems_group_energy_kwh{{group_id="{group_id}",group_name="{group_name}"}} {val}')
            
        # Define HELP and TYPE for kW (gauge)
        lines.append("# HELP ems_group_active_power_kw Total aggregated active power for the group in kW")
        lines.append("# TYPE ems_group_active_power_kw gauge")
        for r in rows:
            group_id = r["group_id"]
            group_name = r["group_name"].replace('"', '\\"') if r["group_name"] else "Unknown"
            val = r["total_kw"] if r["total_kw"] is not None else 0.0
            lines.append(f'ems_group_active_power_kw{{group_id="{group_id}",group_name="{group_name}"}} {val}')
            
        return "\n".join(lines) + "\n"
        
    finally:
        conn.close()
