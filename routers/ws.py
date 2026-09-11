"""
routers/ws.py — WebSocket compatibility layer for FastAPI / ASGI.
"""

from ems_core.ws import ConnectionManager, manager

try:
    from fastapi import APIRouter, WebSocket, WebSocketDisconnect
    router = APIRouter()

    @router.websocket("/ws/heartbeats")
    async def websocket_heartbeats(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)
except ImportError:
    router = None
