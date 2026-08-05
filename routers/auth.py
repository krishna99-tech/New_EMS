"""
routers/auth.py — authentication routes and login guard.

Routes:
  POST  /api/login
  POST  /api/logout
  GET   /api/auth_status

Exports:
  require_login(request)       — API guard (401)
  require_login_page(request)    — HTML guard (redirect to /login)
  template_context(request)      — shared Jinja context
"""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from config import ADMIN_USERNAME, ADMIN_PASSWORD, BASE_DIR

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


def is_logged_in(request: Request) -> bool:
    return bool(request.session.get("logged_in"))


def require_login(request: Request) -> None:
    """Raise 401 for API routes when session is missing."""
    if not is_logged_in(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_login_page(request: Request) -> Optional[RedirectResponse]:
    """Return redirect to login for HTML page routes."""
    if not is_logged_in(request):
        return RedirectResponse(url="/login", status_code=303)
    return None


def template_context(request: Request, **extra) -> dict:
    """Standard template variables for operator pages."""
    ctx = {
        "request": request,
        "logged_in": is_logged_in(request),
    }
    ctx.update(extra)
    return ctx


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if is_logged_in(request):
        return RedirectResponse(url="/admin", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/api/login")
async def login(request: Request):
    data = await request.json()
    if data.get("username") == ADMIN_USERNAME and data.get("password") == ADMIN_PASSWORD:
        request.session["logged_in"] = True
        return {"success": True}
    return JSONResponse({"error": "Invalid credentials"}, status_code=401)


@router.post("/api/logout")
def logout(request: Request):
    request.session.pop("logged_in", None)
    return {"success": True}


@router.get("/api/auth_status")
def auth_status(request: Request):
    return {"logged_in": is_logged_in(request)}
