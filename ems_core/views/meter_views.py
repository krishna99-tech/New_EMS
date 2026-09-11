"""
ems_core/views/meter_views.py — Plant / meter discovery, latest data, group latest, and SSE stream.
"""

import json
import time
from datetime import datetime
import psycopg2.extras
from django.http import JsonResponse, StreamingHttpResponse, HttpResponseBadRequest, HttpResponseNotFound

from database import get_db_connection
from helpers import get_all_meters, get_all_plants
from services.meter_service import fetch_latest_rows
from services import group_service
from ems_core.views.utils import login_required_api


def get_plants_list(request):
    """Return list of distinct plants."""
    return JsonResponse(get_all_plants(), safe=False)


def get_meters_list(request):
    """Return meters for a given plant (or all if not specified)."""
    plant = request.GET.get("plant")
    meters_data = [
        {"id": mid, "name": data["name"], "type": data.get("type", "submeter")}
        for mid, data in get_all_meters(plant).items()
    ]
    return JsonResponse(meters_data, safe=False)


def get_latest_data(request):
    """Return latest data rows for a plant and optional meter."""
    plant = request.GET.get("plant")
    meter = request.GET.get("meter")
    if not plant:
        return JsonResponse({"detail": "plant is required"}, status=400)
    rows = fetch_latest_rows(plant, meter)
    return JsonResponse(rows, safe=False)


@login_required_api
def group_latest(request):
    """Return latest aggregate and per-meter data for a group."""
    group_id_param = request.GET.get("group_id")
    if not group_id_param:
        return JsonResponse({"detail": "group_id is required"}, status=400)
    try:
        group_id = int(group_id_param)
    except ValueError:
        return JsonResponse({"detail": "group_id must be an integer"}, status=400)

    group_data = group_service.get_group_with_members(group_id)
    if not group_data:
        return JsonResponse({"detail": "Group not found"}, status=404)

    members = group_data.get("members", [])
    if not members:
        return JsonResponse({
            "group_id": group_id,
            "name": group_data["name"],
            "overall_kwh": 0,
            "meters": [],
        })

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    overall_kwh = 0
    meter_results = []

    for member in members:
        plant = member["plant"]
        meter_id = member["meter_id"]

        cur.execute(
            "SELECT * FROM meter_data WHERE plant=%s AND meter_id=%s "
            "ORDER BY timestamp DESC LIMIT 1",
            (plant, int(meter_id)),
        )
        row = cur.fetchone()
        if row:
            val_kwh = float(row.get("kwh") or 0)
            overall_kwh += val_kwh

            normalized = dict(row)
            if isinstance(normalized.get("timestamp"), datetime):
                normalized["timestamp"] = normalized["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
            meter_results.append(normalized)

    conn.close()

    return JsonResponse({
        "group_id": group_id,
        "name": group_data["name"],
        "overall_kwh": round(overall_kwh, 2),
        "meters": meter_results,
    })


def stream_latest(request):
    """Server-Sent Events (SSE) endpoint for live meter streaming."""
    plant = request.GET.get("plant")
    meter = request.GET.get("meter")
    if not plant or not meter:
        return HttpResponseBadRequest("plant and meter are required")

    def event_stream():
        last_signature = None
        conn = get_db_connection()
        while True:
            try:
                rows = fetch_latest_rows(plant, meter, conn)
                signature = (
                    "|".join(f"{r.get('meter_id')}:{r.get('id')}" for r in rows)
                    if rows else "empty"
                )
                if signature != last_signature:
                    payload = {
                        "plant": plant,
                        "meter": meter,
                        "rows": rows,
                        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                    yield f"event: latest\ndata: {json.dumps(payload)}\n\n"
                    last_signature = signature
                else:
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err_payload = {"message": str(e)[:180]}
                yield f"event: error\ndata: {json.dumps(err_payload)}\n\n"
                try:
                    conn.close()
                except Exception:
                    pass
                conn = get_db_connection()
            time.sleep(2)

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
