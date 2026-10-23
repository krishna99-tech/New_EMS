import os

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Database ───────────────────────────────────────────────────────────────────
DB_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:9154243400@localhost:5432/ems_db"
)

# ── Authentication ─────────────────────────────────────────────────────────────
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password123")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "d350bf03cf87c736e4ec666a83615b6e9235987dfb716e3765fc0b2de71c27be")

# ── Live-status threshold ──────────────────────────────────────────────────────
OFFLINE_THRESHOLD_SECONDS = int(os.environ.get("OFFLINE_THRESHOLD_SECONDS", 300))

# ── App & UDP ports ────────────────────────────────────────────────────────────
APP_PORT = int(os.environ.get("APP_PORT", 10012))
UDP_IP   = os.environ.get("UDP_IP", "0.0.0.0")
UDP_PORT = int(os.environ.get("UDP_PORT", 10011))
