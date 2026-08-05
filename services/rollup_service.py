import datetime
import psycopg2.extras
from database import get_db_connection
from services import group_service
from helpers import fetch_value_bounds_in_window

def perform_daily_rollup():
    """
    Calculate the total energy (kWh) consumed by each group for the previous day
    and store it in the group_daily_summary table.
    """
    now = datetime.datetime.now()
    
    # A "production day" ends at 06:00 AM. 
    # If this runs at 06:01 AM, we are calculating the total for the previous calendar day's production shift.
    yesterday = now - datetime.timedelta(days=1)
    
    window_start = yesterday.replace(hour=6, minute=0, second=0, microsecond=0)
    window_end = now.replace(hour=5, minute=59, second=59, microsecond=999999)
    
    date_str = yesterday.date().isoformat()
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        groups = group_service.get_all_groups()
        for group in groups:
            group_id = group["id"]
            group_data = group_service.get_group_with_members(group_id)
            if not group_data or not group_data.get("members"):
                continue
                
            total_kwh_for_group = 0.0
            
            for member in group_data["members"]:
                plant = member["plant"]
                meter = member["meter_id"]
                
                # We need the first and last kwh value for the day
                start_row, end_row = fetch_value_bounds_in_window(
                    cur, plant, meter, window_start, window_end, "kwh"
                )
                
                if start_row and end_row:
                    start_kwh = float(start_row["val"] or 0)
                    end_kwh = float(end_row["val"] or 0)
                    diff = max(0, end_kwh - start_kwh)
                    total_kwh_for_group += diff
            
            # Insert or update the daily summary
            cur.execute(
                """
                INSERT INTO group_daily_summary (group_id, date, total_kwh)
                VALUES (%s, %s, %s)
                ON CONFLICT (group_id, date) DO UPDATE 
                SET total_kwh = EXCLUDED.total_kwh
                """,
                (group_id, date_str, round(total_kwh_for_group, 2))
            )
            
        conn.commit()
        print(f"[{datetime.datetime.now()}] Successfully completed daily group rollup for {date_str}.")
    except Exception as e:
        print(f"Error performing daily rollup: {e}")
        conn.rollback()
    finally:
        conn.close()
