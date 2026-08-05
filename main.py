"""
main.py — application entry point.

Start with:
    uvicorn main:app --reload
"""

import os
import threading
import asyncio

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from config import BASE_DIR, SESSION_SECRET
from database import init_db
from udp_server import udp_server

from routers import auth, meters, admin, analytics, export, reports, ws

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

# ── Top-level routes ───────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/favicon.ico", response_class=FileResponse)
def favicon():
    return os.path.join(BASE_DIR, "static", "images", "logo.png")


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup_event():
    try:
        init_db()
    except Exception as e:
        print(f"Warning: Database initialization failed. Check your Postgres connection. Error: {e}")

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    t = threading.Thread(target=udp_server, args=(loop,), daemon=True, name="udp_server")
    t.start()
