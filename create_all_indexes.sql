-- ============================================================================
-- FUSO Energy Monitoring System (EMS) — Database Performance Indexing Script
-- Run this in PostgreSQL, pgAdmin, or DBeaver to optimize query performance.
-- ============================================================================

-- 1. meter_data (Primary time-series telemetry table: Live views, CSV export, shift rollups)
CREATE INDEX IF NOT EXISTS idx_meter_data_plant_meter_ts_desc 
    ON meter_data (plant, meter_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_meter_data_plant_ts_desc 
    ON meter_data (plant, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_meter_data_ts_desc 
    ON meter_data (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_meter_data_status 
    ON meter_data (status);

-- 2. meter_config (Submeter lookups, incomer identification, and plant device listings)
CREATE INDEX IF NOT EXISTS idx_meter_config_plant 
    ON meter_config (plant);

CREATE INDEX IF NOT EXISTS idx_meter_config_plant_meter 
    ON meter_config (plant, meter_id);

CREATE INDEX IF NOT EXISTS idx_meter_config_plant_type 
    ON meter_config (plant, type);

-- 3. plants & locations (Foreign key joins and location-wise plant filtering)
CREATE INDEX IF NOT EXISTS idx_plants_location_id 
    ON plants (location_id);

CREATE INDEX IF NOT EXISTS idx_meter_groups_location_id 
    ON meter_groups (location_id);

-- 4. meter_group_members (Department / zone groupings & reverse plant-meter lookups)
CREATE INDEX IF NOT EXISTS idx_meter_group_members_group_id 
    ON meter_group_members (group_id);

CREATE INDEX IF NOT EXISTS idx_meter_group_members_plant_meter 
    ON meter_group_members (plant, meter_id);

-- 5. group_daily_summary (Daily shift aggregations & historical analytics charts)
CREATE INDEX IF NOT EXISTS idx_group_daily_summary_date 
    ON group_daily_summary (date);

-- 6. device_configs & heartbeats (Hardware mapping to plant name and live gateway health)
CREATE INDEX IF NOT EXISTS idx_device_configs_plant 
    ON device_configs (plant);

CREATE INDEX IF NOT EXISTS idx_device_heartbeats_last_seen 
    ON device_heartbeats (last_seen DESC);
