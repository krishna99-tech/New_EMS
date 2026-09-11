"""
ems_core/views/admin_views.py — Admin UI, Users, Plants, Locations, Meter Configs, Groups.
"""

import json
import psycopg2
import psycopg2.extras
from django.http import JsonResponse, HttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from database import get_db_connection
from services import (
    group_service,
    plant_service,
    device_service,
    meter_config_service,
    location_service,
)
from ems_core.views.auth_views import hash_password
from ems_core.views.utils import (
    parse_json,
    login_required_page,
    admin_required_page,
    login_required_api,
    admin_required_api,
)


# ── Admin Pages ───────────────────────────────────────────────────────────────

@login_required_page
def admin_page(request):
    return render(request, "admin.html")


@login_required_page
def theme_settings_page(request):
    return render(request, "theme_settings.html")


@admin_required_page
def admin_users_page(request):
    return render(request, "admin_users.html", {"active_page": "users"})


# ── Plants CRUD ────────────────────────────────────────────────────────────────

@csrf_exempt
@admin_required_api
def add_plant(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    plant_name = data.get("name")
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    res = plant_service.create_plant(plant_name, location_id)
    return JsonResponse(res, safe=False)


def get_plants_detailed(request):
    res = plant_service.get_all_plants_detailed()
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def delete_plant(request, plant_name: str):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    delete_data = request.GET.get("delete_data", "false")
    do_delete = delete_data.lower() == "true"
    res = plant_service.delete_plant(plant_name, do_delete)
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def update_plant_location_route(request, plant_name: str):
    if request.method != "PUT":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    res = plant_service.update_plant_location(plant_name, location_id)
    return JsonResponse(res, safe=False)


# ── Locations CRUD ─────────────────────────────────────────────────────────────

@login_required_api
def get_locations(request):
    res = location_service.get_locations()
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def add_location(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    name = data.get("name")
    res = location_service.create_location(name)
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def delete_location(request, location_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    res = location_service.delete_location(location_id)
    return JsonResponse(res, safe=False)


# ── Meter config CRUD ──────────────────────────────────────────────────────────

@login_required_api
def get_meter_configs(request):
    res = meter_config_service.get_all_meter_configs()
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def save_meter_config(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    config_id = data.get("id")
    plant    = data.get("plant")
    meter_id = data.get("meter_id")
    name     = data.get("name")
    m_type   = data.get("type", "submeter")

    try:
        if meter_id is not None:
            meter_id = int(meter_id)
    except ValueError:
        return JsonResponse({"detail": "Meter ID must be an integer"}, status=400)

    res = meter_config_service.save_meter_config(config_id, plant, meter_id, name, m_type)
    return JsonResponse(res, safe=False)


@csrf_exempt
@admin_required_api
def delete_meter_config(request, config_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    res = meter_config_service.delete_meter_config(config_id)
    return JsonResponse(res, safe=False)


# ── Meter groups ───────────────────────────────────────────────────────────────

@login_required_api
def get_meter_groups(request):
    res = group_service.get_all_groups()
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def create_meter_group(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    name = data.get("name", "").strip()
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    res = group_service.create_group(name, location_id)
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def delete_meter_group(request, group_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    group_service.delete_group(group_id)
    return JsonResponse({"success": True})


@csrf_exempt
@login_required_api
def update_meter_group_location_route(request, group_id: int):
    if request.method != "PUT":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    res = group_service.update_group_location(group_id, location_id)
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def add_meter_group_member(request, group_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    plant = data.get("plant")
    meter_id = data.get("meter_id")
    if not plant or not meter_id:
        return JsonResponse({"detail": "Plant and meter_id are required"}, status=400)
    res = group_service.add_group_member(group_id, plant, meter_id)
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def remove_meter_group_member(request, group_id: int, member_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    group_service.remove_group_member(group_id, member_id)
    return JsonResponse({"success": True})


@login_required_api
def list_group_presets(request):
    res = group_service.list_presets()
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def create_group_preset(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    preset_id = (data.get("preset_id") or "").strip()
    plant = (data.get("plant") or "").strip() or None
    res = group_service.create_preset_group(preset_id, plant)
    return JsonResponse(res, safe=False)


# ── Device configs ─────────────────────────────────────────────────────────────

@login_required_api
def list_device_configs(request):
    res = device_service.get_all_device_configs()
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def register_device_config(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    device_id = (data.get("device_id") or "").strip()
    plant     = (data.get("plant") or "").strip()
    label     = (data.get("label") or "").strip()
    location_id = data.get("location_id")
    res = device_service.register_device(device_id, plant, label, location_id)
    return JsonResponse(res, safe=False)


@csrf_exempt
@login_required_api
def unregister_device_config(request, device_id: str):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    res = device_service.unregister_device(device_id)
    return JsonResponse(res, safe=False)


# ── Device heartbeats ──────────────────────────────────────────────────────────

@login_required_api
def device_heartbeats(request):
    res = device_service.get_all_device_heartbeats()
    return JsonResponse(res, safe=False)


# ── Export / Import config ─────────────────────────────────────────────────────

@login_required_api
def export_config(request):
    config = meter_config_service.export_config_data()
    json_bytes = json.dumps(config, indent=2, ensure_ascii=False).encode("utf-8")
    resp = HttpResponse(json_bytes, content_type="application/json")
    resp["Content-Disposition"] = 'attachment; filename="ems_config.json"'
    return resp


@csrf_exempt
@admin_required_api
def import_config(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    if not isinstance(data, dict):
        return JsonResponse({"detail": "Expected a JSON object at the top level"}, status=400)
    res = meter_config_service.import_config_data(data)
    return JsonResponse(res, safe=False)


# ── User Management ────────────────────────────────────────────────────────────

@admin_required_api
def get_users(request):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, username, role, created_at FROM users ORDER BY id ASC")
    users = cur.fetchall()
    conn.close()

    for u in users:
        if u.get('created_at'):
            u['created_at'] = u['created_at'].isoformat()
    return JsonResponse(users, safe=False)


@csrf_exempt
@admin_required_api
def create_user(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    username = data.get("username")
    password = data.get("password")
    role = data.get("role", "admin")

    if not username or not password:
        return JsonResponse({"detail": "Username and password are required"}, status=400)

    password_hash = hash_password(password)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s) RETURNING id",
            (username, password_hash, role)
        )
        new_id = cur.fetchone()[0]
        cur.execute("INSERT INTO user_settings (user_id) VALUES (%s)", (new_id,))
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        conn.close()
        return JsonResponse({"detail": "Username already exists"}, status=400)
    except Exception as e:
        conn.rollback()
        conn.close()
        return JsonResponse({"detail": str(e)}, status=500)

    conn.close()
    return JsonResponse({"success": True, "id": new_id, "message": "User created successfully"})


@csrf_exempt
@admin_required_api
def delete_user(request, user_id: int):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    current_user_id = request.session.get("user_id")
    if current_user_id == user_id:
        return JsonResponse({"detail": "You cannot delete yourself"}, status=400)

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()

    if not deleted:
        return JsonResponse({"detail": "User not found"}, status=404)
    return JsonResponse({"success": True, "message": "User deleted successfully"})


@csrf_exempt
@admin_required_api
def update_user_password(request, user_id: int):
    if request.method != "PUT":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    data = parse_json(request)
    new_password = data.get("password")

    if not new_password or len(new_password) < 4:
        return JsonResponse({"detail": "New password must be at least 4 characters long"}, status=400)

    password_hash = hash_password(new_password)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
    updated = cur.rowcount > 0
    conn.commit()
    conn.close()

    if not updated:
        return JsonResponse({"detail": "User not found"}, status=404)

    return JsonResponse({"success": True, "message": "Password updated successfully"})


# ── User Settings ──────────────────────────────────────────────────────────────

@login_required_api
def get_user_settings(request):
    user_id = request.session.get("user_id")
    if not user_id:
        return JsonResponse({"detail": "User ID not found in session"}, status=401)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT theme, color_preset, custom_primary, custom_sub FROM user_settings WHERE user_id = %s", (user_id,))
    settings = cur.fetchone()
    conn.close()

    if not settings:
        return JsonResponse({"theme": "light", "color_preset": "blue", "custom_primary": "#4f46e5", "custom_sub": "#6366f1"})
    return JsonResponse(dict(settings))


@csrf_exempt
@login_required_api
def update_user_settings(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    user_id = request.session.get("user_id")
    if not user_id:
        return JsonResponse({"detail": "User ID not found in session"}, status=401)

    data = parse_json(request)
    theme = data.get("theme")
    color_preset = data.get("color_preset")
    custom_primary = data.get("custom_primary")
    custom_sub = data.get("custom_sub")

    conn = get_db_connection()
    cur = conn.cursor()

    updates = []
    params = []
    if theme is not None:
        updates.append("theme = %s")
        params.append(theme)
    if color_preset is not None:
        updates.append("color_preset = %s")
        params.append(color_preset)
    if custom_primary is not None:
        updates.append("custom_primary = %s")
        params.append(custom_primary)
    if custom_sub is not None:
        updates.append("custom_sub = %s")
        params.append(custom_sub)

    if updates:
        params.append(user_id)
        query = f"UPDATE user_settings SET {', '.join(updates)} WHERE user_id = %s"
        cur.execute(query, tuple(params))

        if cur.rowcount == 0:
            cur.execute(
                "INSERT INTO user_settings (user_id, theme, color_preset, custom_primary, custom_sub) "
                "VALUES (%s, COALESCE(%s, 'light'), COALESCE(%s, 'blue'), COALESCE(%s, '#4f46e5'), COALESCE(%s, '#6366f1'))",
                (user_id, theme, color_preset, custom_primary, custom_sub)
            )
        conn.commit()
    conn.close()

    return JsonResponse({"success": True, "message": "Settings updated"})
