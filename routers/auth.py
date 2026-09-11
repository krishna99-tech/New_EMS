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

from passlib.context import CryptContext

import config
from database import get_db_connection

router = APIRouter()
templates = Jinja2Templates(directory=os.path.join(config.BASE_DIR, "templates"))
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def is_logged_in(request: Request) -> bool:
    return bool(request.session.get("logged_in"))


def require_login(request: Request) -> None:
    """Raise 401 for API routes when session is missing."""
    if not is_logged_in(request):
        raise HTTPException(status_code=401, detail="Unauthorized")

def require_admin(request: Request) -> None:
    """Raise 403 for API routes when user is not an admin."""
    require_login(request)
    if request.session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required")

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
        "username": request.session.get("username"),
        "role": request.session.get("role", "operator"),
    }
    
    user_id = request.session.get("user_id")
    if user_id:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT theme, color_preset, custom_primary, custom_sub FROM user_settings WHERE user_id = %s", (user_id,))
        settings = cur.fetchone()
        conn.close()
        if settings:
            ctx["user_settings"] = {
                "theme": settings[0],
                "color_preset": settings[1],
                "custom_primary": settings[2],
                "custom_sub": settings[3],
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
    username = data.get("username")
    password = data.get("password")
    
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, password_hash, role FROM users WHERE username = %s", (username,))
    user = cur.fetchone()
    conn.close()
    
    if user:
        user_id, password_hash, role = user
        if pwd_context.verify(password, password_hash):
            request.session["logged_in"] = True
            request.session["user_id"] = user_id
            request.session["username"] = username
            request.session["role"] = role
            return {"success": True}
            
    return JSONResponse({"error": "Invalid credentials"}, status_code=401)


@router.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    response = JSONResponse({"success": True, "message": "Logged out successfully"})
    response.delete_cookie("session")
    return response


@router.get("/api/auth_status")
def auth_status(request: Request):
    return {"logged_in": is_logged_in(request)}


@router.post("/api/change_password")
async def change_password(request: Request):
    if not is_logged_in(request):
        return JSONResponse({"error": "Session expired. Please log in again."}, status_code=401)
    
    data = await request.json()
    old_pw = data.get("old_password")
    new_pw = data.get("new_password")
    confirm_pw = data.get("confirm_password")

    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "User ID not found in session"}, status_code=401)
        
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT password_hash FROM users WHERE id = %s", (user_id,))
    user = cur.fetchone()
    
    if not user or not pwd_context.verify(old_pw, user[0]):
        conn.close()
        return JSONResponse({"error": "Current password is incorrect"}, status_code=400)
        
    if not new_pw or len(new_pw) < 4:
        conn.close()
        return JSONResponse({"error": "New password must be at least 4 characters long"}, status_code=400)
    if new_pw != confirm_pw:
        conn.close()
        return JSONResponse({"error": "New password and confirmation do not match"}, status_code=400)

    new_hash = pwd_context.hash(new_pw)
    cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user_id))
    conn.commit()
    conn.close()
    
    return {"success": True, "message": "Password updated successfully"}
