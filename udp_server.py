"""
udp_server.py — background UDP listener (Event-Driven).

Receives JSON payloads from energy meters, drops them into an in-memory queue,
and uses a background worker thread to process them and save to PostgreSQL.
"""

import json
import socket
import asyncio
import threading
import queue

from config import UDP_IP, UDP_PORT
from services import meter_service
from routers.ws import manager

# In-memory queue for decoupling network I/O from DB I/O
udp_queue = queue.Queue()

def udp_worker(loop=None):
    """Background worker that pulls packets from the queue and saves them to the DB."""
    print("UDP Background Worker started.")
    while True:
        try:
            # Block until a packet is available
            item = udp_queue.get()
            if item is None:
                break
                
            payload, ip_addr = item
            
            # Process the reading via the Service layer
            meter_service.process_reading(payload, ip_addr)
            
            # Broadcast update to UI via WebSockets
            if loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast('{"event": "heartbeat_updated"}'),
                    loop
                )
                
            udp_queue.task_done()
        except Exception as e:
            print("Error in UDP Worker:", e)

def udp_server(loop=None):
    """Network listener that simply dumps raw packets into the queue."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind((UDP_IP, UDP_PORT))
    except OSError as e:
        print(f"UDP bind failed on {UDP_IP}:{UDP_PORT}: {e}")
        return

    print(f"UDP Server Listening on {UDP_PORT}")
    
    # Start the background database worker
    worker = threading.Thread(target=udp_worker, args=(loop,), daemon=True, name="udp_worker")
    worker.start()

    while True:
        try:
            data, addr = sock.recvfrom(4096)
            ip_addr = addr[0]
            payload = json.loads(data.decode())
            
            # Push to internal event bus (queue) immediately
            udp_queue.put((payload, ip_addr))
            
        except Exception as e:
            print("Error receiving UDP packet:", e)

