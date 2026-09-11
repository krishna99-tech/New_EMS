"""
main.py — Application entry point for the Django EMS application.

Run with any of:
    python manage.py runserver 0.0.0.0:8000
    python main.py
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
import sys

# Configure Django settings
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ems_project.settings")

# Expose ASGI application as 'app' for uvicorn main:app
from ems_project.asgi import application as app

if __name__ == "__main__":
    from django.core.management import execute_from_command_line
    args = sys.argv
    if len(args) == 1:
        args = ["manage.py", "runserver", "0.0.0.0:8000"]
    execute_from_command_line(args)
