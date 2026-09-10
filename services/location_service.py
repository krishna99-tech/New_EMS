import psycopg2
from fastapi import HTTPException
from database import get_db_connection

def get_locations():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM locations ORDER BY name ASC")
    rows = cur.fetchall()
    conn.close()
    
    locations = []
    for row in rows:
        locations.append({"id": row[0], "name": row[1]})
    return locations

def create_location(name: str):
    if not name:
        raise HTTPException(status_code=400, detail="Location name is required")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO locations (name) VALUES (%s) RETURNING id", (name,))
        new_id = cur.fetchone()[0]
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Location already exists")
    conn.close()
    return {"success": True, "location_id": new_id, "name": name}

def delete_location(location_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM locations WHERE id=%s", (location_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"success": True}
