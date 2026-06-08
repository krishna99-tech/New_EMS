# EMS Fuso Energy Meter Dashboard

A Flask-based energy metering dashboard and analytics service for multiple plant meters.

The application receives UDP payloads from energy meters, stores meter readings in a local SQLite database, and exposes HTTP APIs for plant and meter metadata, latest values, energy summaries, streaming updates, and CSV exports.

## Key features

- UDP listener for meter payload ingestion on port `10011`
- Flask web interface and API on port `10012`
- SQLite persistence with automatic schema migration
- Plant/meter metadata driven by `meter_map.json`
- Latest meter retrieval and server-sent events streaming
- Shift-based energy summaries and incomer parameter aggregation
- CSV export for submeters, all submeters, and incomer detail

## Requirements

- Python 3.8+ (recommended)
- Flask

## Installation

1. Create a Python virtual environment:

```powershell
python -m venv .venv
```

2. Activate the environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

3. Install dependencies:

```powershell
pip install -r requirements.txt
```

## Running the app

From the repository root:

```powershell
python app.py
```

This starts:

- HTTP server on `http://0.0.0.0:10012`
- UDP listener on `0.0.0.0:10011`

The Flask app uses `templates/index.html` for the UI and serves static assets from `static/`.

## Configuration

- `meter_map.json` defines plants, meters, names, and meter types (`incomer` or `submeter`).
- `meters.db` is created automatically in the project root.

## UDP payload format

The app expects JSON payloads over UDP with this structure:

```json
{
  "device": "PlantName",
  "timestamp": "YYYY-MM-DD HH:MM:SS",
  "meters": [
    {
      "id": 1,
      "status": "OK",
      "kwh": 123.45,
      "kw": 12.3,
      "kva": 13.4,
      "pf": 0.98,
      "volt": 230.0,
      "curr": 15.2,
      "freq": 50.0,
      "line_voltage": 400.0,
      "line_to_line_voltage": 398.0,
      "avg_voltage": 399.0,
      "voltage_unbalance": 0.5,
      "line_current": 27.5,
      "current_l1": 9.1,
      "current_l2": 9.0,
      "current_l3": 9.4,
      "avg_current": 9.17,
      "neutral_line_current": 0.2,
      "kw_l1": 4.0,
      "kw_l2": 4.1,
      "kw_l3": 4.2,
      "kw_total": 12.3,
      "kva_l1": 4.5,
      "kva_l2": 4.6,
      "kva_l3": 4.7,
      "kva_total": 13.8,
      "kva_max_demand": 14.0
    }
  ]
}
```

- `incomer` meters store the full electrical parameter set.
- `submeter` meters store only `kwh` and metadata.

## HTTP API endpoints

### `/`
Returns the UI homepage from `templates/index.html`.

### `/plants`
Returns a JSON list of plants from `meter_map.json`.

### `/meters?plant=<plant>`
Returns metadata for meters in a plant.

Example response:

```json
[
  {"id": "1", "name": "Incomer", "type": "incomer"},
  {"id": "2", "name": "Meter A", "type": "submeter"}
]
```

### `/latest?plant=<plant>&meter=<meter|all>`
Returns the latest stored meter row for a specific meter or all meters in a plant.

### `/stream_latest?plant=<plant>&meter=<meter|all>`
Returns server-sent events for the latest meter data.

### `/energy_summary?plant=<plant>&meter=<meter>&from_dt=<iso>&to_dt=<iso>&mode=<shiftwise|totalshifts>&shift=<all|Shift A|Shift B|Shift C>`
Returns energy summary data for a meter over the requested range.

### `/incomer_shift_summary?plant=<plant>&meter=<meter>&from_dt=<iso>&to_dt=<iso>&shift=<all|Shift A|Shift B|Shift C>`
Returns summarized incomer power-quality and energy series for incomer meters.

### `/export_csv?plant=<plant>&meter=<meter|all>&from_dt=<iso>&to_dt=<iso>&shift_analysis=<true|false>&shift=<all|Shift A|Shift B|Shift C>`
Returns a CSV download.

- `meter=all` produces totals for all submeters.
- `shift_analysis=true` applies shift-based consumption windows.

## Shift logic

- Shift A: `06:00-14:00`
- Shift B: `14:00-22:00`
- Shift C: `22:00-06:00`
- Production day runs from `06:00` to next day `06:00`

## Notes

- The app automatically creates the SQLite database schema and adds missing columns if the schema evolves.
- `incomer` meters are treated as the single incomer per plant.
- `submeter` records are normalized to only retain `kwh` values.

## Known considerations

- The UDP listener uses port `10011` and must be reachable by the meter data source.
- The Flask HTTP service listens on `0.0.0.0:10012`.

---

If you want, I can also add example `curl` commands for the API endpoints or help adjust `meter_map.json` for your specific plant layout.
