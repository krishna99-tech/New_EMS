import psycopg2
from datetime import datetime, timedelta
import random
from database import get_db_connection

def seed_history():
    plant_name = "Factory plant A"  # Maps to device_id 202330
    meter_ids = [1, 2, 6, 9, 10]
    
    # Starting kwh values for each meter to ensure they increment realistically
    kwh_counters = {
        1: 1699.63,
        2: 4637.74,
        6: 3679.44,
        9: 4061.07,
        10: 2313.52
    }
    
    # 10 days ago
    end_time = datetime.now()
    start_time = end_time - timedelta(days=10)
    
    num_points = 1000
    time_step = (end_time - start_time) / num_points
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    print(f"Seeding 1000 data points over the last 10 days for plant: {plant_name} (Device ID 202330)")
    
    current_time = start_time
    inserted_count = 0
    
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
                
            cur.execute("""
                INSERT INTO meter_data (
                    plant, meter_id, meter_name, meter_type, status, kwh, timestamp
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                plant_name,
                meter_id,
                f"Meter {meter_id}", 
                "submeter" if meter_id > 1 else "incomer", 
                status,
                round(kwh_counters[meter_id], 2),
                current_time
            ))
            inserted_count += 1
            
        current_time += time_step
        
    conn.commit()
    cur.close()
    conn.close()
    print(f"Successfully inserted {inserted_count} historical records.")

if __name__ == "__main__":
    seed_history()
