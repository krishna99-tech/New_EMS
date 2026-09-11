"""
ASGI config for ems_project with WebSocket support.
"""

import os
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ems_project.settings")

django_http_app = get_asgi_application()

from ems_core.ws import websocket_heartbeats_app

async def application(scope, receive, send):
    if scope.get("type") == "websocket" and scope.get("path") == "/ws/heartbeats":
        await websocket_heartbeats_app(scope, receive, send)
    else:
        await django_http_app(scope, receive, send)
