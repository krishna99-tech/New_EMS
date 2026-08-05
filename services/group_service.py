import psycopg2.extras
from database import get_db_connection
from fastapi import HTTPException

def get_all_groups():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cur.execute("SELECT id, name FROM meter_groups ORDER BY name")
    groups = cur.fetchall()
    
    cur.execute("""
        SELECT m.id, m.group_id, m.plant, m.meter_id, c.name as meter_name 
        FROM meter_group_members m
        LEFT JOIN meter_config c ON m.plant = c.plant AND m.meter_id = c.meter_id
        ORDER BY m.plant, m.meter_id
    """)
    members = cur.fetchall()
    conn.close()
    
    groups_dict = {g["id"]: {"id": g["id"], "name": g["name"], "members": []} for g in groups}
    for m in members:
        if m["group_id"] in groups_dict:
            groups_dict[m["group_id"]]["members"].append(dict(m))
            
    return list(groups_dict.values())

def create_group(name: str):
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO meter_groups (name) VALUES (%s) RETURNING id", (name,))
        group_id = cur.fetchone()[0]
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Group with this name already exists")
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
        
    conn.close()
    return {"id": group_id, "name": name, "members": []}

def delete_group(group_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM meter_groups WHERE id = %s", (group_id,))
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Group not found")

def add_group_member(group_id: int, plant: str, meter_id: str):
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT 1 FROM meter_groups WHERE id = %s", (group_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Group not found")
        
    try:
        cur.execute(
            "INSERT INTO meter_group_members (group_id, plant, meter_id) VALUES (%s, %s, %s) RETURNING id",
            (group_id, plant, meter_id)
        )
        member_id = cur.fetchone()[0]
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Meter is already in this group")
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
        
    conn.close()
    return {"id": member_id, "group_id": group_id, "plant": plant, "meter_id": meter_id}

def remove_group_member(group_id: int, member_id: int):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM meter_group_members WHERE id = %s AND group_id = %s", (member_id, group_id))
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Member not found in this group")


def get_group_by_name(name: str):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, name FROM meter_groups WHERE name = %s", (name,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def create_or_get_group(name: str):
    existing = get_group_by_name(name)
    if existing:
        return existing["id"], False
    created = create_group(name)
    return created["id"], True


def add_members_bulk(group_id: int, members: list):
    """Add (plant, meter_id) pairs; skip duplicates. Returns (added, skipped)."""
    conn = get_db_connection()
    cur = conn.cursor()
    added = 0
    skipped = 0
    for plant, meter_id in members:
        cur.execute(
            "SELECT 1 FROM meter_group_members WHERE group_id=%s AND plant=%s AND meter_id=%s",
            (group_id, plant, str(meter_id)),
        )
        if cur.fetchone():
            skipped += 1
            continue
        cur.execute(
            "INSERT INTO meter_group_members (group_id, plant, meter_id) VALUES (%s, %s, %s)",
            (group_id, plant, str(meter_id)),
        )
        added += 1
    conn.commit()
    conn.close()
    return added, skipped


PRESET_DEFINITIONS = {
    "all_incomers": {
        "label": "All Incomers (cross-plant)",
        "name": "All Incomers",
        "meter_type": "incomer",
        "plant": None,
    },
    "all_submeters": {
        "label": "All Submeters (cross-plant)",
        "name": "All Submeters",
        "meter_type": "submeter",
        "plant": None,
    },
}


def list_presets():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT DISTINCT plant FROM meter_config ORDER BY plant")
    plants = [r["plant"] for r in cur.fetchall()]
    conn.close()

    presets = [
        {"id": k, "label": v["label"], "requires_plant": False}
        for k, v in PRESET_DEFINITIONS.items()
    ]
    for plant in plants:
        presets.append({
            "id": "plant_submeters",
            "label": f"{plant} — Submeters",
            "requires_plant": True,
            "plant": plant,
        })
        presets.append({
            "id": "plant_all",
            "label": f"{plant} — All Meters",
            "requires_plant": True,
            "plant": plant,
        })
    return presets


def create_preset_group(preset_id: str, plant: str = None):
    if preset_id in PRESET_DEFINITIONS:
        cfg = PRESET_DEFINITIONS[preset_id]
        group_name = cfg["name"]
        meter_type = cfg["meter_type"]
        plant_filter = None
    elif preset_id == "plant_submeters" and plant:
        group_name = f"{plant} — Submeters"
        meter_type = "submeter"
        plant_filter = plant
    elif preset_id == "plant_all" and plant:
        group_name = f"{plant} — All Meters"
        meter_type = None
        plant_filter = plant
    else:
        raise HTTPException(status_code=400, detail="Invalid preset or missing plant")

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if plant_filter:
        if meter_type:
            cur.execute(
                "SELECT plant, meter_id FROM meter_config WHERE plant=%s AND type=%s ORDER BY meter_id",
                (plant_filter, meter_type),
            )
        else:
            cur.execute(
                "SELECT plant, meter_id FROM meter_config WHERE plant=%s ORDER BY meter_id",
                (plant_filter,),
            )
    elif meter_type:
        cur.execute(
            "SELECT plant, meter_id FROM meter_config WHERE type=%s ORDER BY plant, meter_id",
            (meter_type,),
        )
    else:
        cur.execute("SELECT plant, meter_id FROM meter_config ORDER BY plant, meter_id")
    rows = cur.fetchall()
    conn.close()

    if not rows:
        raise HTTPException(status_code=400, detail="No meters match this preset")

    group_id, created = create_or_get_group(group_name)
    members = [(r["plant"], r["meter_id"]) for r in rows]
    added, skipped = add_members_bulk(group_id, members)

    return {
        "group_id": group_id,
        "name": group_name,
        "created": created,
        "members_added": added,
        "members_skipped": skipped,
        "total_members": len(get_group_with_members(group_id)["members"]),
    }


def get_group_with_members(group_id: int):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cur.execute("SELECT name FROM meter_groups WHERE id=%s", (group_id,))
    group_row = cur.fetchone()
    if not group_row:
        conn.close()
        return None
        
    cur.execute("SELECT plant, meter_id FROM meter_group_members WHERE group_id=%s", (group_id,))
    members = cur.fetchall()
    conn.close()
    
    return {
        "name": group_row["name"],
        "members": members
    }

