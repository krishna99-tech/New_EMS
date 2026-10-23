# ESP32 Industrial EMS Energy Meter Gateway & Datalogger

Firmware implementation (`updating_new.ino`) for an industrial edge gateway designed to collect energy consumption data from Schneider Electric iEM3xxx Modbus energy meters, timestamp readings via hardware RTC, buffer data offline during network outages, and stream telemetry over Ethernet UDP to the central EMS dashboard.

---

## 1. System Overview

```
 +---------------------------------------------+
 |       Schneider iEM3xxx Energy Meters       |
 |            (Slave IDs 1 to 32)              |
 +---------------------------------------------+
                       ▲
                       │ Modbus RTU / RS485 (9600 8E1)
                       ▼
       +-------------------------------+
       |       MAX485 Transceiver      |
       +-------------------------------+
                       ▲
                       │ Serial2 (GPIO 32, 33, 4)
                       ▼
       +-------------------------------+
       |       ESP32 Microcontroller   |◄──── I2C (GPIO 21, 22) ────► DS3231 RTC
       +-------------------------------+
          │                         │
          │ HSPI (GPIO 5, 18, 19, 23)│ VSPI (GPIO 12, 13, 14, 15, 25)
          ▼                         ▼
  +---------------+         +---------------------+
  | MicroSD Card  |         |   W5500 Ethernet    |
  | (Offline Log) |         +---------------------+
  +---------------+                    │
                                       │ UDP Telemetry (Port 10011)
                                       ▼
                       +-------------------------------+
                       |  EMS Server (udp_server.py)   |
                       |       & Web Dashboard         |
                       +-------------------------------+
```

---

## 2. Hardware Pinout & Wiring

### A. RS485 / MAX485 Transceiver
| MAX485 Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **RO (Receiver Output)** | `GPIO 32` | ESP32 Hardware `Serial2` RX |
| **DI (Driver Input)** | `GPIO 33` | ESP32 Hardware `Serial2` TX |
| **DE & RE (Jumpered)** | `GPIO 4` | Direction control (`HIGH` = TX, `LOW` = RX) |
| **VCC & GND** | 3.3V / 5V & GND | Power Supply |
| **A & B** | Modbus Bus Lines | Connected to Meter A(+) and B(-) with termination resistor |

### B. DS3231 Real-Time Clock (I2C)
| RTC Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **SDA** | `GPIO 21` | I2C Data |
| **SCL** | `GPIO 22` | I2C Clock |
| **VCC & GND** | 3.3V & GND | Power Supply |

### C. MicroSD Card Module (HSPI Bus)
| MicroSD Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **CS** | `GPIO 5` | Chip Select |
| **SCK** | `GPIO 18` | HSPI Clock |
| **MISO** | `GPIO 19` | HSPI Data In |
| **MOSI** | `GPIO 23` | HSPI Data Out |

### D. W5500 Ethernet Module (VSPI Bus)
| W5500 Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **CS** | `GPIO 15` | SPI Chip Select |
| **SCK** | `GPIO 14` | SPI Clock |
| **MISO** | `GPIO 12` | SPI Data In |
| **MOSI** | `GPIO 13` | SPI Data Out |
| **RST** | `GPIO 25` | Hardware Reset |

---

## 3. Key Features & How It Works

### 1. Smart Modbus Meter Polling
- **Target Meter Series**: Schneider Electric iEM3xxx series.
- **Register Polled**: Holding Register `2699` (Delivered Active Energy Wh / kWh, 32-bit IEEE 754 float spanning 2 registers).
- **Auto-Discovery & Suppression of Inactive Slots**:
  - The firmware scans Slave IDs `1` to `32`.
  - Meters that have **never** responded are treated as unpopulated physical slots and skipped silently, eliminating false alarms.
- **Fault Confirmation**:
  - If an active meter stops responding, it requires **3 consecutive timeouts** (`OFFLINE_CONFIRM_COUNT = 3`) before being flagged as `"OFFLINE"`.
  - Transmission noise resulting in bad checksums is flagged as `"CRC_ERROR"`.

### 2. High-Accuracy Hardware Timestamping
- Queries the onboard **DS3231 RTC** to tag each batch with the exact current timestamp formatted as `YYYY-MM-DD HH:MM:SS`.
- Does not depend on NTP or active internet connection to maintain valid time across reboots.

### 3. Store-and-Forward (Zero Data Loss)
- **Normal Online Operation**: Every 60 seconds, readings are packaged into a JSON payload and transmitted via UDP to the server.
- **Network Outage**:
  - If Ethernet cable is disconnected, or if UDP packet transmission fails, the payload is appended to `/offline_data.jsonl` on the MicroSD card.
- **Automatic Backlog Recovery**:
  - When the network link status returns to `LinkON`, the gateway immediately catches the event, opens `/offline_data.jsonl`, pushes all accumulated records sequentially over UDP with a 30 ms pacing delay, and clears the file.

---

## 4. Telemetry Data Format

Data is sent via standard UDP datagrams in JSON format:

```json
{
  "device": "202326",
  "timestamp": "2026-10-18 10:20:00",
  "meters": [
    {
      "id": 1,
      "status": "OK",
      "kwh": 12845.32
    },
    {
      "id": 2,
      "status": "OK",
      "kwh": 3410.15
    },
    {
      "id": 3,
      "status": "OFFLINE"
    }
  ]
}
```

### JSON Schema Attributes
| Field | Type | Description |
| :--- | :--- | :--- |
| `device` | String | Unique hardware/plant identifier configured via `#define PLANT_ID`. |
| `timestamp` | String | Real-time timestamp from RTC (`YYYY-MM-DD HH:MM:SS`). |
| `meters` | Array | List of responding, offline, or faulted meters. |
| `meters[].id` | Integer | Modbus Slave ID (1–32). |
| `meters[].status` | String | Status indicator: `"OK"`, `"OFFLINE"`, or `"CRC_ERROR"`. |
| `meters[].kwh` | Float | Cumulative energy reading rounded to two decimal places (only present when status is `"OK"`). |

---

## 5. Configuration Settings

Open `updating_new.ino` to modify project constants:

```cpp
// Unique Device/Plant identifier
#define PLANT_ID "202326"

// Network Settings
IPAddress ip(192, 168, 0, 229);         // Gateway Static IP
IPAddress remoteIP(192, 168, 0, 159);     // Destination Server IP (udp_server.py)
const unsigned int remotePort = 10011;   // Destination UDP Port
const unsigned int localPort  = 8888;    // Gateway Local UDP Port

// Polling interval
const unsigned long dataInterval = 60000; // 60,000 ms (1 minute)

// Modbus range
#define MIN_SLAVE_ID  1
#define MAX_SLAVE_ID  32
```

---

## 6. Required Libraries

Install via the Arduino IDE Library Manager or PlatformIO:

1. **Ethernet** by Various / Paul Stoffregen (for W5500 SPI Ethernet)
2. **ModbusMaster** by Doc Walker
3. **ArduinoJson** (Version 6.x) by Benoit Blanchon
4. **RTClib** by Adafruit
5. **SD** & **SPI** & **Wire** (Standard ESP32 Arduino Core libraries)

---

## 7. Diagnostics & Troubleshooting

| Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| `[RTC] WARNING: RTC DS3231 not detected!` | I2C pull-ups missing or wiring loose. | Check `GPIO 21` (SDA) and `GPIO 22` (SCL) connections and battery voltage. |
| `[SD] WARNING: SD card initialization failed!` | SPI conflict or bad wiring on HSPI. | Ensure `GPIO 5` is set as CS, check card formatting (FAT32). |
| `[ETH] Hardware Status: EthernetNoHardware` | W5500 reset or SPI pins incorrect. | Check power (3.3V supply must support >150mA), check RST pin `GPIO 25`. |
| Modbus `FAIL` or `CRC_ERR` on all meters | RS485 polarities inverted or baud mismatch. | Swap A & B lines, verify 9600 baud, 8 data bits, Even parity (`8E1`). |
| Data saved to SD but not reaching dashboard | Server firewall or wrong destination IP/Port. | Check if `udp_server.py` is listening on `192.168.0.159:10011` and check local firewall rules. |
