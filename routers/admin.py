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
from routers.auth import require_login, require_login_page, template_context
from services import group_service, plant_service, device_service, meter_config_service

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


# ── Plants CRUD ────────────────────────────────────────────────────────────────

@router.post("/api/plants")
async def add_plant(request: Request):
    require_login(request)
    data = await request.json()
    plant_name = data.get("name")
    return plant_service.create_plant(plant_name)


@router.delete("/api/plants/{plant_name}")
def delete_plant(plant_name: str, request: Request, delete_data: str = "false"):
    require_login(request)
    do_delete = delete_data.lower() == "true"
    return plant_service.delete_plant(plant_name, do_delete)


# ── Meter config CRUD ──────────────────────────────────────────────────────────

@router.get("/api/meter_config")
def get_meter_configs(request: Request):
    require_login(request)
    return meter_config_service.get_all_meter_configs()


@router.post("/api/meter_config")
async def save_meter_config(request: Request):
    require_login(request)
    data = await request.json()
    plant    = data.get("plant")
    meter_id = data.get("meter_id")
    name     = data.get("name")
    m_type   = data.get("type", "submeter")

    try:
        if meter_id is not None:
            meter_id = int(meter_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Meter ID must be an integer")

    return meter_config_service.save_meter_config(plant, meter_id, name, m_type)


@router.delete("/api/meter_config/{config_id}")
def delete_meter_config(config_id: int, request: Request):
    require_login(request)
    return meter_config_service.delete_meter_config(config_id)


# ── Meter groups ───────────────────────────────────────────────────────────────

@router.get("/admin/groups", response_class=HTMLResponse)
def admin_groups_page(request: Request):
    redirect = require_login_page(request)
    if redirect:
        return redirect
    return templates.TemplateResponse("admin_groups.html", template_context(request))

@router.get("/api/meter_groups")
def get_meter_groups(request: Request):
    require_login(request)
    return group_service.get_all_groups()


@router.post("/api/meter_groups")
async def create_meter_group(request: Request):
    require_login(request)
    data = await request.json()
    name = data.get("name", "").strip()
    return group_service.create_group(name)


@router.delete("/api/meter_groups/{group_id}")
def delete_meter_group(group_id: int, request: Request):
    require_login(request)
    group_service.delete_group(group_id)
    return {"success": True}


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
    
    return device_service.register_device(device_id, plant, label)


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
    require_login(request)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object at the top level")

    return meter_config_service.import_config_data(data)
