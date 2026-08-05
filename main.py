"""
main.py — application entry point.

Start with:
    uvicorn main:app --reload
"""

import os
import threading
import asyncio
import datetime

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from config import BASE_DIR, SESSION_SECRET
from database import init_db
from udp_server import udp_server

from routers.auth import require_login_page, template_context
from routers import auth, meters, admin, analytics, export, reports, ws, metrics, overview

# ── App setup ──────────────────────────────────────────────────────────────────

app = FastAPI(title="EMS Fuso", version="1.0.0")

app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# ── Include routers ────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(meters.router)
app.include_router(admin.router)
app.include_router(analytics.router)
app.include_router(export.router)
app.include_router(reports.router)
app.include_router(ws.router)
app.include_router(metrics.router)
app.include_router(overview.router)

# ── Top-level routes ───────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        template_context(request, active_nav="dashboard"),
    )


@app.get("/groups", response_class=HTMLResponse)
def groups_dashboard(request: Request):
    redirect = require_login_page(request)
    if redirect:
        return redirect
    return templates.TemplateResponse(
        "groups.html",
        template_context(request, active_nav="groups"),
    )


@app.get("/favicon.ico", response_class=FileResponse)
def favicon():
    return os.path.join(BASE_DIR, "static", "images", "logo.png")


# ── Background Tasks ────────────────────────────────────────────────────────
async def scheduled_daily_rollup():
    """Runs the group daily rollup script automatically at 06:01 every day (end of production day)."""
    while True:
        now = datetime.datetime.now()
        if now.hour == 6 and now.minute == 1:
            try:
                from services.rollup_service import perform_daily_rollup
                # Run in thread so it doesn't block the async event loop
                await asyncio.to_thread(perform_daily_rollup)
            except Exception as e:
                print(f"Rollup Error: {e}")
            # sleep to avoid running twice in the same minute
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(30)

# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup_event():
    try:
        init_db()
    except Exception as e:
        print(f"Warning: Database initialization failed. Check your Postgres connection. Error: {e}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(scheduled_daily_rollup())
    except RuntimeError:
        loop = None

    t = threading.Thread(target=udp_server, args=(loop,), daemon=True, name="udp_server")
    t.start()
