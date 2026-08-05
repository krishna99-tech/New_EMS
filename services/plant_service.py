import psycopg2
from fastapi import HTTPException
from database import get_db_connection

def create_plant(plant_name: str):
    if not plant_name:
        raise HTTPException(status_code=400, detail="Plant name is required")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO plants (name) VALUES (%s)", (plant_name,))
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Plant already exists")
    conn.close()
    return {"success": True}

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
