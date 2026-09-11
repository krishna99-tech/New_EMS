"""
routers/admin.py — admin UI and CRUD routes for plants & meter configs.

Routes:
  GET    /admin
  POST   /api/plants
  DELETE /api/plants/{plant_name}
  GET    /api/meter_config
  POST   /api/meter_config
  DELETE /api/meter_config/{config_id}
  GET    /api/export_config
  POST   /api/import_config
"""

import json

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.templating import Jinja2Templates

from config import BASE_DIR
from routers.auth import require_login, require_login_page, require_admin, template_context, hash_password
from services import group_service, plant_service, device_service, meter_config_service, location_service
from database import get_db_connection

import os

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


# ── Admin UI ───────────────────────────────────────────────────────────────────

@router.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    redirect = require_login_page(request)
    if redirect:
        return redirect
    return templates.TemplateResponse("admin.html", template_context(request))


@router.get("/admin/theme_settings", response_class=HTMLResponse)
def theme_settings(request: Request):
    redirect = require_login_page(request)
    if redirect:
        return redirect
    return templates.TemplateResponse("theme_settings.html", template_context(request))


# ── Plants CRUD ────────────────────────────────────────────────────────────────

@router.post("/api/plants")
async def add_plant(request: Request):
    require_admin(request)
    data = await request.json()
    plant_name = data.get("name")
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    return plant_service.create_plant(plant_name, location_id)

@router.get("/api/plants_detailed")
def get_plants_detailed(request: Request):
    return plant_service.get_all_plants_detailed()


@router.delete("/api/plants/{plant_name}")
def delete_plant(plant_name: str, request: Request, delete_data: str = "false"):
    require_admin(request)
    do_delete = delete_data.lower() == "true"
    return plant_service.delete_plant(plant_name, do_delete)

@router.put("/api/plants/{plant_name}/location")
async def update_plant_location_route(plant_name: str, request: Request):
    require_admin(request)
    data = await request.json()
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    return plant_service.update_plant_location(plant_name, location_id)


# ── Locations CRUD ─────────────────────────────────────────────────────────────

@router.get("/api/locations")
def get_locations(request: Request):
    require_login(request)
    return location_service.get_locations()

@router.post("/api/locations")
async def add_location(request: Request):
    require_admin(request)
    data = await request.json()
    name = data.get("name")
    return location_service.create_location(name)

@router.delete("/api/locations/{location_id}")
def delete_location(location_id: int, request: Request):
    require_admin(request)
    return location_service.delete_location(location_id)


# ── Meter config CRUD ──────────────────────────────────────────────────────────

@router.get("/api/meter_config")
def get_meter_configs(request: Request):
    require_login(request)
    return meter_config_service.get_all_meter_configs()


@router.post("/api/meter_config")
async def save_meter_config(request: Request):
    require_admin(request)
    data = await request.json()
    config_id = data.get("id")
    plant    = data.get("plant")
    meter_id = data.get("meter_id")
    name     = data.get("name")
    m_type   = data.get("type", "submeter")

    try:
        if meter_id is not None:
            meter_id = int(meter_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Meter ID must be an integer")

    return meter_config_service.save_meter_config(config_id, plant, meter_id, name, m_type)


@router.delete("/api/meter_config/{config_id}")
def delete_meter_config(config_id: int, request: Request):
    require_admin(request)
    return meter_config_service.delete_meter_config(config_id)


# ── Meter groups ───────────────────────────────────────────────────────────────
# /admin/groups page removed — groups are managed via the Groups tab in /admin

@router.get("/api/meter_groups")
def get_meter_groups(request: Request):
    require_login(request)
    return group_service.get_all_groups()


@router.post("/api/meter_groups")
async def create_meter_group(request: Request):
    require_login(request)
    data = await request.json()
    name = data.get("name", "").strip()
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    return group_service.create_group(name, location_id)


@router.delete("/api/meter_groups/{group_id}")
def delete_meter_group(group_id: int, request: Request):
    require_login(request)
    group_service.delete_group(group_id)
    return {"success": True}

@router.put("/api/meter_groups/{group_id}/location")
async def update_meter_group_location_route(group_id: int, request: Request):
    require_login(request)
    data = await request.json()
    location_id = data.get("location_id")
    if location_id:
        try:
            location_id = int(location_id)
        except ValueError:
            location_id = None
    return group_service.update_group_location(group_id, location_id)


@router.post("/api/meter_groups/{group_id}/members")
async def add_meter_group_member(group_id: int, request: Request):
    require_login(request)
    data = await request.json()
    plant = data.get("plant")
    meter_id = data.get("meter_id")
    
    if not plant or not meter_id:
        raise HTTPException(status_code=400, detail="Plant and meter_id are required")
        
    return group_service.add_group_member(group_id, plant, meter_id)


@router.delete("/api/meter_groups/{group_id}/members/{member_id}")
def remove_meter_group_member(group_id: int, member_id: int, request: Request):
    require_login(request)
    group_service.remove_group_member(group_id, member_id)
    return {"success": True}


@router.get("/api/meter_groups/presets")
def list_group_presets(request: Request):
    require_login(request)
    return group_service.list_presets()


@router.post("/api/meter_groups/presets")
async def create_group_preset(request: Request):
    require_login(request)
    data = await request.json()
    preset_id = (data.get("preset_id") or "").strip()
    plant = (data.get("plant") or "").strip() or None
    return group_service.create_preset_group(preset_id, plant)


# ── Device configs (device_id → plant mapping) ─────────────────────────────────

@router.get("/api/device_configs")
def list_device_configs(request: Request):
    """Return all registered device_id → plant mappings."""
    require_login(request)
    return device_service.get_all_device_configs()


@router.post("/api/device_configs")
async def register_device_config(request: Request):
    """Register or update a device_id → plant mapping."""
    require_login(request)
    data = await request.json()
    device_id = (data.get("device_id") or "").strip()
    plant     = (data.get("plant") or "").strip()
    label     = (data.get("label") or "").strip()
    location_id = data.get("location_id")
    
    return device_service.register_device(device_id, plant, label, location_id)


@router.delete("/api/device_configs/{device_id}")
def unregister_device_config(device_id: str, request: Request):
    """Remove a device_id → plant mapping."""
    require_login(request)
    return device_service.unregister_device(device_id)


# ── Device heartbeats ──────────────────────────────────────────────────────────


@router.get("/api/device_heartbeats")
def device_heartbeats(request: Request):
    """
    Return all devices that have ever sent a UDP packet.
    """
    require_login(request)
    return device_service.get_all_device_heartbeats()


# ── Export config ──────────────────────────────────────────────────────────────

@router.get("/api/export_config")
def export_config(request: Request):
    """
    Download the current plants + meter config as a JSON file.
    """
    require_login(request)
    
    config = meter_config_service.export_config_data()
    
    json_bytes = json.dumps(config, indent=2, ensure_ascii=False).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="ems_config.json"'},
    )


# ── Import config ──────────────────────────────────────────────────────────────

@router.post("/api/import_config")
async def import_config(request: Request):
    """
    Bulk-upsert plants and meter configs from a JSON body.
    """
    require_admin(request)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object at the top level")

    return meter_config_service.import_config_data(data)

# ── User Management ────────────────────────────────────────────────────────────

@router.get("/admin/users", response_class=HTMLResponse)
def admin_users(request: Request):
    redirect = require_login_page(request)
    if redirect:
        return redirect
    from fastapi.responses import RedirectResponse
    if request.session.get("role") != "admin":
        return RedirectResponse(url="/admin", status_code=303)
    return templates.TemplateResponse("admin_users.html", template_context(request, active_page='users'))

@router.get("/api/users")
def get_users(request: Request):
    require_admin(request)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, username, role, created_at FROM users ORDER BY id ASC")
    users = cur.fetchall()
    conn.close()
    
    # Format datetime objects into strings for JSON serialization
    for u in users:
        if u.get('created_at'):
            u['created_at'] = u['created_at'].isoformat()
    return users

@router.post("/api/users")
async def create_user(request: Request):
    require_admin(request)
    data = await request.json()
    username = data.get("username")
    password = data.get("password")
    role = data.get("role", "admin")
    
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")
        
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
        raise HTTPException(status_code=400, detail="Username already exists")
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    
    conn.close()
    return {"success": True, "id": new_id, "message": "User created successfully"}

@router.delete("/api/users/{user_id}")
def delete_user(user_id: int, request: Request):
    require_admin(request)
    current_user_id = request.session.get("user_id")
    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
        
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()
    
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": "User deleted successfully"}

@router.put("/api/users/{user_id}/password")
async def update_user_password(user_id: int, request: Request):
    require_admin(request)
    data = await request.json()
    new_password = data.get("password")
    
    if not new_password or len(new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters long")
        
    password_hash = hash_password(new_password)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
    updated = cur.rowcount > 0
    conn.commit()
    conn.close()
    
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
        
    return {"success": True, "message": "Password updated successfully"}

# ── User Settings ──────────────────────────────────────────────────────────────

@router.get("/api/user/settings")
def get_user_settings(request: Request):
    require_login(request)
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID not found in session")
        
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT theme, color_preset, custom_primary, custom_sub FROM user_settings WHERE user_id = %s", (user_id,))
    settings = cur.fetchone()
    conn.close()
    
    if not settings:
        return {"theme": "light", "color_preset": "blue", "custom_primary": "#4f46e5", "custom_sub": "#6366f1"}
    return dict(settings)

@router.post("/api/user/settings")
async def update_user_settings(request: Request):
    require_login(request)
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID not found in session")
        
    data = await request.json()
    theme = data.get("theme")
    color_preset = data.get("color_preset")
    custom_primary = data.get("custom_primary")
    custom_sub = data.get("custom_sub")
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # We will only update the fields that were provided
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
            # Maybe setting row doesn't exist for this user? Insert it
            cur.execute(
                "INSERT INTO user_settings (user_id, theme, color_preset, custom_primary, custom_sub) "
                "VALUES (%s, COALESCE(%s, 'light'), COALESCE(%s, 'blue'), COALESCE(%s, '#4f46e5'), COALESCE(%s, '#6366f1'))",
                (user_id, theme, color_preset, custom_primary, custom_sub)
            )
        conn.commit()
    conn.close()
    
    return {"success": True, "message": "Settings updated"}

