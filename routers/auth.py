"""
routers/auth.py — authentication routes and login guard.

Routes:
  POST  /api/login
  POST  /api/logout
  GET   /api/auth_status

Exports:
  require_login(request)  — dependency used by other routers
"""

import os
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from config import ADMIN_USERNAME, ADMIN_PASSWORD, BASE_DIR

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


# ── Dependency ─────────────────────────────────────────────────────────────────

def require_login(request: Request):
    if not request.session.get("logged_in"):
        if request.url.path.startswith("/api/"):
            raise HTTPException(status_code=401, detail="Unauthorized")
        else:
            raise HTTPException(status_code=303, headers={"Location": "/login"})


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    """Serve the standalone login page."""
    if request.session.get("logged_in"):
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
    return {"logged_in": request.session.get("logged_in", False)}
