import psycopg2.extras
from database import get_db_connection

def get_report_consumption_summary(plant: str, start_date: str, end_date: str):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cur.execute("""
        SELECT 
            meter_name, 
            meter_type, 
            MIN(kwh) as start_kwh, 
            MAX(kwh) as end_kwh
        FROM meter_data
        WHERE plant = %s AND timestamp >= %s AND timestamp <= %s
        GROUP BY meter_name, meter_type
        ORDER BY meter_type ASC, meter_name ASC
    """, (plant, start_date, end_date))
    
    rows = cur.fetchall()
    conn.close()
    return rows

def get_raw_meter_data(plant: str, meter_id: int, from_dt: str, to_dt: str):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    query = """
        SELECT
            timestamp, plant, meter_id, meter_name, meter_type, status,
            kwh, kw, kva, pf, volt, curr, freq,
            line_voltage, line_to_line_voltage, avg_voltage, voltage_unbalance,
            line_current, current_l1, current_l2, current_l3, avg_current,
            neutral_line_current, kw_l1, kw_l2, kw_l3, kw_total,
            kva_l1, kva_l2, kva_l3, kva_total, kva_max_demand
        FROM meter_data
        WHERE plant=%s AND meter_id=%s AND timestamp>=%s AND timestamp<=%s
        ORDER BY timestamp ASC
    """
    cur.execute(query, (plant, meter_id, from_dt, to_dt))
    rows = cur.fetchall()
    conn.close()
    return rows

