import psycopg2
from datetime import datetime, timedelta
import random

# ============================================================
# CHANGE THIS to your target database connection string
# Format: postgresql://USER:PASSWORD@HOST:PORT/DBNAME
# ============================================================
REMOTE_DB_URL = "postgresql://myuser:mypassword@100.77.110.74:5432/ems_db"

def seed_history():
    plant_name = "Architecture"
    meter_ids = [1, 2, 5, 10, 32]
    
    kwh_counters = {
        1: 3800.00,
        2: 3200.00,
        5: 1300.00,
        10: 3000.00,
        32: 2200.00
    }
    
    end_time = datetime.now()
    start_time = end_time - timedelta(days=10)
    num_points = 1000
    time_step = (end_time - start_time) / num_points
    
    print(f"Connecting to: {REMOTE_DB_URL}")
    conn = psycopg2.connect(REMOTE_DB_URL)
    cur = conn.cursor()
    
    print(f"Building {num_points * len(meter_ids)} records in memory...")
    
    rows = []
    current_time = start_time
    for i in range(num_points):
        for meter_id in meter_ids:
            kwh_counters[meter_id] += random.uniform(0.05, 0.5)
            rand_val = random.random()
            if rand_val < 0.95:
                status = "OK"
            elif rand_val < 0.97:
                status = "CRC_ERROR"
            else:
                status = "OFFLINE"
            rows.append((
                plant_name,
                meter_id,
                f"Meter {meter_id}",
                "submeter" if meter_id > 1 else "incomer",
                status,
                round(kwh_counters[meter_id], 2),
                current_time
            ))
        current_time += time_step
    
    print(f"Sending {len(rows)} records to remote DB in one batch... please wait...")
    cur.executemany("""
        INSERT INTO meter_data (
            plant, meter_id, meter_name, meter_type, status, kwh, timestamp
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, rows)
    
    conn.commit()
    cur.close()
    conn.close()
    print(f"Done! Successfully inserted {len(rows)} historical records.")

if __name__ == "__main__":
    seed_history()
