# Elmeasure Multi-Meter Monitoring System (Lamination Plant)

This project implements an industrial IoT gateway using an **ESP32** and a **W5500 Ethernet module**. The system polls data from multiple Elmeasure energy meters via RS485 and transmits the readings to a central server using UDP.

## 🛠 Hardware Configuration

* **Microcontroller:** ESP32
* **Ethernet Module:** WIZnet W5500 (SPI)
* **RS485 Interface:** MAX485 (via Hardware Serial 2)
* **Meter Model:** Elmeasure Energy Meters (LG/EN Series)
* **Total Meter Units:** 13

## 🌐 Network & Server Specifications

The device uses a **Static IP** configuration to ensure consistent communication without dependency on a DHCP server.

* **ESP32 Static IP:** `192.168.0.229`
* **Subnet Mask:** `255.255.255.0`
* **Gateway:** `192.168.0.254`
* **Remote Server IP:** `192.168.0.41`
* **Transmission Protocol:** UDP
* **UDP Remote Port:** `10011`

## ⚡ Energy Meter Details

The system is configured to read the **Total Accumulated Energy (kWh)** from the meters.

* **Modbus Slave IDs:** `1, 2, 4, 7, 8, 9, 10, 13, 15, 16, 17, 19, 20`
* **kWh Register Address:** `158` (Holding Register)
* **Data Format:** 32-bit Float (Word-swapped / CDAB format)
* **Serial Settings:** 9600 Baud, 8E1 (8 data bits, Even parity, 1 stop bit)

## 📌 Pin Mapping (ESP32)

| Interface       | Pin Name          | ESP32 Pin    |
| :-------------- | :---------------- | :----------- |
| **W5500** | MOSI / MISO / SCK | 13 / 12 / 14 |
| **W5500** | CS / RST          | 15 / 25      |
| **RS485** | RX2 / TX2         | 32 / 33      |
| **RS485** | RE_DE (Control)   | 4            |

## 📦 Data Payload structure

The data is sent as a JSON object every 60 seconds:

```json
{
  "device": "LaminationPlant",
  "meters": [
    { "id": 1, "status": "OK", "kwh": 450.25 },
    { "id": 2, "status": "OFFLINE" }
  ]
}
```
