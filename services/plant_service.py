import psycopg2
from fastapi import HTTPException
from database import get_db_connection

def create_plant(plant_name: str, location_id: int = None):
    if not plant_name:
        raise HTTPException(status_code=400, detail="Plant name is required")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO plants (name, location_id) VALUES (%s, %s)", (plant_name, location_id))
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Plant already exists")
    conn.close()
    return {"success": True}

def get_all_plants_detailed():
    """Returns a list of plant dictionaries including their location_id and location name."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT p.name, p.location_id, l.name as location_name 
        FROM plants p
        LEFT JOIN locations l ON p.location_id = l.id
        ORDER BY p.name ASC
    """)
    rows = cur.fetchall()
    conn.close()
    
    plants = []
    for row in rows:
        plants.append({
            "name": row[0],
            "location_id": row[1],
            "location_name": row[2]
        })
    return plants

def delete_plant(plant_name: str, do_delete: bool):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM plants WHERE name=%s", (plant_name,))
        cur.execute("DELETE FROM meter_config WHERE plant=%s", (plant_name,))
        if do_delete:
            cur.execute("DELETE FROM meter_data WHERE plant=%s", (plant_name,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"success": True}

def update_plant_location(plant_name: str, location_id: int = None):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE plants SET location_id = %s WHERE name = %s", (location_id, plant_name))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"success": True}
