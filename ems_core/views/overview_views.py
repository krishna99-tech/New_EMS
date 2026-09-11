"""
ems_core/views/overview_views.py — System overview and Prometheus metrics endpoints.
"""

from django.http import JsonResponse, HttpResponse
import psycopg2.extras
from database import get_db_connection
from services.overview_service import get_system_overview


def system_overview(request):
    """Return high-level system overview stats."""
    return JsonResponse(get_system_overview())


def group_metrics_prometheus(request):
    """
    Expose grouped energy data in Prometheus standard format.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        cur.execute("SELECT * FROM vw_group_live_status")
        rows = cur.fetchall()

        lines = []
        lines.append("# HELP ems_group_energy_kwh Total aggregated energy consumed by the group in kWh")
        lines.append("# TYPE ems_group_energy_kwh counter")
        for r in rows:
            group_id = r["group_id"]
            group_name = r["group_name"].replace('"', '\\"') if r["group_name"] else "Unknown"
            val = r["total_kwh"] if r["total_kwh"] is not None else 0.0
            lines.append(f'ems_group_energy_kwh{{group_id="{group_id}",group_name="{group_name}"}} {val}')

        lines.append("# HELP ems_group_active_power_kw Total aggregated active power for the group in kW")
        lines.append("# TYPE ems_group_active_power_kw gauge")
        for r in rows:
            group_id = r["group_id"]
            group_name = r["group_name"].replace('"', '\\"') if r["group_name"] else "Unknown"
            val = r["total_kw"] if r["total_kw"] is not None else 0.0
            lines.append(f'ems_group_active_power_kw{{group_id="{group_id}",group_name="{group_name}"}} {val}')

        content = "\n".join(lines) + "\n"
        return HttpResponse(content, content_type="text/plain; charset=utf-8")

    finally:
        conn.close()
