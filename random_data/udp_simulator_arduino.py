import socket
import json
import time
import random

# Configure target IP and Port (User changed this in udp_simulator.py)
UDP_IP = "127.0.0.1" 
UDP_PORT = 10011

# The ID of the Gateway/Device sending data (Matches PLANT_ID in Arduino)
DEVICE_ID = "202330"

# Define the meters 1 through 32 as the Arduino does
MIN_SLAVE_ID = 1
MAX_SLAVE_ID = 32

# Track KWH values so they increment realistically over time
kwh_counters = {slave: random.uniform(1000.0, 5000.0) for slave in range(MIN_SLAVE_ID, MAX_SLAVE_ID + 1)}
known_connected = {slave: False for slave in range(MIN_SLAVE_ID, MAX_SLAVE_ID + 1)}
fail_count = {slave: 0 for slave in range(MIN_SLAVE_ID, MAX_SLAVE_ID + 1)}

OFFLINE_CONFIRM_COUNT = 3

def generate_arduino_payload():
    """Generates a payload simulating the exact JSON output of main_v1.ino"""
    meters_data = []
    
    for slave in range(MIN_SLAVE_ID, MAX_SLAVE_ID + 1):
        
        # We will simulate that only 5 specific meters are actually "plugged in" (e.g. 1, 2, 5, 10, 32)
        # The others will timeout and be skipped just like the Arduino code.
        is_plugged_in = slave in [1, 2, 5, 10, 32]
        
        if is_plugged_in:
            # 95% chance of success, 2% CRC error, 3% timeout
            rand_val = random.random()
            if rand_val < 0.95:
                result = 0 # SUCCESS
            elif rand_val < 0.97:
                result = 2 # CRC ERROR
            else:
                result = 1 # TIMEOUT
        else:
            result = 1 # TIMEOUT always for unplugged meters
            
            
        if result == 0:
            # SUCCESS
            known_connected[slave] = True
            fail_count[slave] = 0
            
            # Increment kWh slightly (e.g., between 0.01 and 0.05 kWh per minute)
            kwh_counters[slave] += random.uniform(0.01, 0.05)
            
            meter_data = {
                "id": slave,
                "status": "OK",
                "kwh": round(kwh_counters[slave], 2)
            }
            meters_data.append(meter_data)
            
        elif result == 1:
            # TIMEOUT
            fail_count[slave] += 1
            
            if not known_connected[slave]:
                # Never connected, skip entirely (EMPTY)
                continue
                
            if fail_count[slave] >= OFFLINE_CONFIRM_COUNT:
                # Confirmed offline
                meter_data = {
                    "id": slave,
                    "status": "OFFLINE"
                }
                meters_data.append(meter_data)
                
        elif result == 2:
            # CRC ERROR
            fail_count[slave] += 1
            if known_connected[slave]:
                meter_data = {
                    "id": slave,
                    "status": "CRC_ERROR"
                }
                meters_data.append(meter_data)

    payload = {
        "device": DEVICE_ID,
        "meters": meters_data
    }
    
    return payload

def start_simulation():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"Starting Arduino UDP Simulation -> Target: {UDP_IP}:{UDP_PORT}")
    print(f"Plant ID: {DEVICE_ID}")
    print("Press Ctrl+C to stop.\n")
    
    try:
        while True:
            payload = generate_arduino_payload()
            json_data = json.dumps(payload).encode('utf-8')
            
            # Send the JSON payload via UDP
            sock.sendto(json_data, (UDP_IP, UDP_PORT))
            
            print(f"========== JSON ==========")
            print(json_data.decode())
            print("UDP Sent\n")
            
            # The Arduino waits 60 seconds between reads, we can use 5 or 10 seconds for faster testing
            time.sleep(10)
    except KeyboardInterrupt:
        print("\nSimulation stopped.")
    finally:
        sock.close()

if __name__ == "__main__":
    start_simulation()
