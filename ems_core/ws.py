"""
ems_core/ws.py — WebSocket connection manager and ASGI WebSocket handler.
"""

class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket):
        self.active_connections.append(websocket)

    def disconnect(self, websocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                # Connection may be FastAPI WebSocket object or ASGI send callable
                if callable(connection):
                    await connection({"type": "websocket.send", "text": message})
                elif hasattr(connection, "send_text"):
                    await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()


async def websocket_heartbeats_app(scope, receive, send):
    """ASGI WebSocket application for /ws/heartbeats."""
    if scope["type"] == "websocket":
        await send({"type": "websocket.accept"})
        await manager.connect(send)
        try:
            while True:
                msg = await receive()
                if msg.get("type") == "websocket.disconnect":
                    manager.disconnect(send)
                    break
        except Exception:
            manager.disconnect(send)
