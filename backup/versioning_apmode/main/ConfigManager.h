#ifndef EMS_CONFIG_MANAGER_H
#define EMS_CONFIG_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>

#if defined(ESP32)
  #include <WiFi.h>
  #include <WebServer.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266WebServer.h>
#endif

#include "WiFiManager.h"

// ===================================================================
// SLAVE METER DATA STRUCTURE
// ===================================================================
#define MAX_SLAVES 32

struct SlaveDevice {
  uint8_t  id;           // Modbus Slave Address (1 to 247)
  char     reg_name[16]; // Register Parameter Name (e.g. "kwh", "Freq_Hz", "voltage")
  uint16_t reg_address;  // Register Address (e.g. 2699 or 156)
  uint32_t baud_rate;    // 9600, 19200, 38400, 115200
  char     parity[8];    // "8E1", "8N1", "8O1"
};

// ===================================================================
// EMS CONFIGURATION DATA STRUCTURE
// ===================================================================
struct EMSConfig {
  // Device & Plant Info
  char plant_id[32];          // e.g. "202326"

  // Network Interface: "ETH" (W5500 Ethernet) or "WIFI" (ESP32 WiFi)
  char net_interface[8];      // "ETH" or "WIFI"
  bool eth_dhcp;              // true: DHCP, false: Static IP
  char eth_ip[20];            // e.g. "192.168.0.229"
  char eth_gateway[20];       // e.g. "192.168.0.1"
  char eth_subnet[20];        // e.g. "255.255.255.0"
  char eth_dns[20];           // e.g. "8.8.8.8"

  // Telemetry Protocol & Server
  char comm_proto[8];         // "UDP" or "MQTT"
  char server_host[64];       // e.g. "192.168.0.159"
  uint16_t server_port;       // e.g. 10011 (UDP) or 1883 (MQTT)
  char mqtt_topic[64];        // e.g. "ems/fuso/energy"
  char mqtt_user[32];         // optional
  char mqtt_pass[32];         // optional
  uint16_t poll_interval_sec; // e.g. 60 seconds

  // Modbus 32-bit Float Endian Format: "ABCD" (Normal), "CDAB" (Word-swapped), "BADC" (Byte-swapped), "DCBA" (True Little-Endian)
  char float_endian[8];

  // Modbus Slaves (Each with custom ID, Register Name, Address, Baud & Parity)
  uint8_t     slave_count;
  SlaveDevice slaves[MAX_SLAVES];
};

// Global active configuration
extern EMSConfig emsConfig;

// Preferences NVS namespace
#define NVS_NAMESPACE "ems_cfg"

// ===================================================================
// SERIALIZATION HELPERS FOR PER-SLAVE SETTINGS
// Format: id:name:reg:baud:parity;id:name:reg:baud:parity...
// ===================================================================
inline void serializeSlaves(const EMSConfig &cfg, char *out, size_t maxLen) {
  out[0] = '\0';
  for (uint8_t i = 0; i < cfg.slave_count && i < MAX_SLAVES; i++) {
    char entry[64];
    const char* nm = (strlen(cfg.slaves[i].reg_name) > 0) ? cfg.slaves[i].reg_name : "kwh";
    snprintf(entry, sizeof(entry), "%d:%s:%d:%lu:%s%s", 
             cfg.slaves[i].id, 
             nm,
             cfg.slaves[i].reg_address, 
             cfg.slaves[i].baud_rate, 
             cfg.slaves[i].parity,
             (i < cfg.slave_count - 1) ? ";" : "");
    strlcat(out, entry, maxLen);
  }
}

inline void deserializeSlaves(EMSConfig &cfg, const char *in) {
  if (in == nullptr || strlen(in) == 0) return;
  cfg.slave_count = 0;
  char buf[1024];
  strlcpy(buf, in, sizeof(buf));
  char *saveptr1;
  char *token = strtok_r(buf, ";", &saveptr1);
  while (token != nullptr && cfg.slave_count < MAX_SLAVES) {
    char *saveptr2;
    char *p1 = strtok_r(token, ":", &saveptr2);
    char *p2 = strtok_r(nullptr, ":", &saveptr2);
    char *p3 = strtok_r(nullptr, ":", &saveptr2);
    char *p4 = strtok_r(nullptr, ":", &saveptr2);
    char *p5 = strtok_r(nullptr, ":", &saveptr2);

    if (p1 && p2) {
      cfg.slaves[cfg.slave_count].id = (uint8_t)atoi(p1);

      // Check if 5 tokens (new format) or 4 tokens (old format)
      if (p5 != nullptr) {
        strlcpy(cfg.slaves[cfg.slave_count].reg_name, p2, sizeof(cfg.slaves[cfg.slave_count].reg_name));
        cfg.slaves[cfg.slave_count].reg_address = (uint16_t)atoi(p3);
        cfg.slaves[cfg.slave_count].baud_rate = (uint32_t)strtoul(p4, nullptr, 10);
        strlcpy(cfg.slaves[cfg.slave_count].parity, p5, sizeof(cfg.slaves[cfg.slave_count].parity));
      } else {
        strlcpy(cfg.slaves[cfg.slave_count].reg_name, "kwh", sizeof(cfg.slaves[cfg.slave_count].reg_name));
        cfg.slaves[cfg.slave_count].reg_address = (uint16_t)atoi(p2);
        cfg.slaves[cfg.slave_count].baud_rate = p3 ? (uint32_t)strtoul(p3, nullptr, 10) : 9600;
        strlcpy(cfg.slaves[cfg.slave_count].parity, p4 ? p4 : "8E1", sizeof(cfg.slaves[cfg.slave_count].parity));
      }
      cfg.slave_count++;
    }
    token = strtok_r(nullptr, ";", &saveptr1);
  }
}

// ===================================================================
// DEFAULT CONFIGURATION VALUES
// ===================================================================
inline void setDefaults(EMSConfig &cfg) {
  strlcpy(cfg.plant_id, "202326", sizeof(cfg.plant_id));
  strlcpy(cfg.net_interface, "ETH", sizeof(cfg.net_interface));
  cfg.eth_dhcp = false;
  strlcpy(cfg.eth_ip, "192.168.0.229", sizeof(cfg.eth_ip));
  strlcpy(cfg.eth_gateway, "192.168.0.1", sizeof(cfg.eth_gateway));
  strlcpy(cfg.eth_subnet, "255.255.255.0", sizeof(cfg.eth_subnet));
  strlcpy(cfg.eth_dns, "8.8.8.8", sizeof(cfg.eth_dns));

  strlcpy(cfg.comm_proto, "UDP", sizeof(cfg.comm_proto));
  strlcpy(cfg.server_host, "192.168.0.159", sizeof(cfg.server_host));
  cfg.server_port = 10011;
  strlcpy(cfg.mqtt_topic, "ems/fuso/energy", sizeof(cfg.mqtt_topic));
  strlcpy(cfg.mqtt_user, "", sizeof(cfg.mqtt_user));
  strlcpy(cfg.mqtt_pass, "", sizeof(cfg.mqtt_pass));
  cfg.poll_interval_sec = 60;

  strlcpy(cfg.float_endian, "ABCD", sizeof(cfg.float_endian)); // Default: ABCD (Normal / Motorola)

  // Default to 1 slave (ID 1, Param "kwh", Reg 2699, 9600, 8E1)
  cfg.slave_count = 1;
  cfg.slaves[0].id = 1;
  strlcpy(cfg.slaves[0].reg_name, "kwh", sizeof(cfg.slaves[0].reg_name));
  cfg.slaves[0].reg_address = 2699;
  cfg.slaves[0].baud_rate = 9600;
  strlcpy(cfg.slaves[0].parity, "8E1", sizeof(cfg.slaves[0].parity));
}

// ===================================================================
// NVS STORAGE (Preferences) LOAD & SAVE
// ===================================================================
inline bool loadConfig(EMSConfig &cfg) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) {
    Serial.println("[NVS] Notice: Initializing new NVS namespace.");
    setDefaults(cfg);
    return false;
  }

  if (!prefs.isKey("cfg_init")) {
    Serial.println("[NVS] No saved configuration found in flash memory. Loaded defaults.");
    prefs.end();
    setDefaults(cfg);
    return false;
  }

  prefs.getString("plant_id", cfg.plant_id, sizeof(cfg.plant_id));
  prefs.getString("net_if", cfg.net_interface, sizeof(cfg.net_interface));
  cfg.eth_dhcp = prefs.getBool("eth_dhcp", false);
  prefs.getString("eth_ip", cfg.eth_ip, sizeof(cfg.eth_ip));
  prefs.getString("eth_gw", cfg.eth_gateway, sizeof(cfg.eth_gateway));
  prefs.getString("eth_sn", cfg.eth_subnet, sizeof(cfg.eth_subnet));
  prefs.getString("eth_dns", cfg.eth_dns, sizeof(cfg.eth_dns));

  prefs.getString("comm_proto", cfg.comm_proto, sizeof(cfg.comm_proto));
  prefs.getString("srv_host", cfg.server_host, sizeof(cfg.server_host));
  cfg.server_port = prefs.getUShort("srv_port", 10011);
  prefs.getString("mq_topic", cfg.mqtt_topic, sizeof(cfg.mqtt_topic));
  prefs.getString("mq_user", cfg.mqtt_user, sizeof(cfg.mqtt_user));
  prefs.getString("mq_pass", cfg.mqtt_pass, sizeof(cfg.mqtt_pass));
  cfg.poll_interval_sec = prefs.getUShort("interval", 60);

  if (prefs.isKey("flt_endian")) {
    prefs.getString("flt_endian", cfg.float_endian, sizeof(cfg.float_endian));
  } else {
    strlcpy(cfg.float_endian, "ABCD", sizeof(cfg.float_endian));
  }

  // Load per-slave configuration string
  String slavesStr = prefs.getString("slaves_cfg", "");
  if (slavesStr.length() > 0) {
    deserializeSlaves(cfg, slavesStr.c_str());
  } else {
    // Fallback: 1 default slave
    cfg.slave_count = 1;
    cfg.slaves[0].id = 1;
    strlcpy(cfg.slaves[0].reg_name, "kwh", sizeof(cfg.slaves[0].reg_name));
    cfg.slaves[0].reg_address = 2699;
    cfg.slaves[0].baud_rate = 9600;
    strlcpy(cfg.slaves[0].parity, "8E1", sizeof(cfg.slaves[0].parity));
  }

  prefs.end();
  Serial.println("[NVS] Configuration successfully loaded from NVS flash.");
  return true;
}

inline bool saveConfig(const EMSConfig &cfg) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) {
    Serial.println("[NVS] ERROR: Failed to open NVS for writing!");
    return false;
  }

  prefs.putBool("cfg_init", true);
  prefs.putString("plant_id", cfg.plant_id);
  prefs.putString("net_if", cfg.net_interface);
  prefs.putBool("eth_dhcp", cfg.eth_dhcp);
  prefs.putString("eth_ip", cfg.eth_ip);
  prefs.putString("eth_gw", cfg.eth_gateway);
  prefs.putString("eth_sn", cfg.eth_subnet);
  prefs.putString("eth_dns", cfg.eth_dns);

  prefs.putString("comm_proto", cfg.comm_proto);
  prefs.putString("srv_host", cfg.server_host);
  prefs.putUShort("srv_port", cfg.server_port);
  prefs.putString("mq_topic", cfg.mqtt_topic);
  prefs.putString("mq_user", cfg.mqtt_user);
  prefs.putString("mq_pass", cfg.mqtt_pass);
  prefs.putUShort("interval", cfg.poll_interval_sec);
  prefs.putString("flt_endian", cfg.float_endian);

  // Save serialized slave devices string
  char slavesBuf[1024];
  serializeSlaves(cfg, slavesBuf, sizeof(slavesBuf));
  prefs.putString("slaves_cfg", slavesBuf);

  prefs.end();
  Serial.println("[NVS] Configuration saved to NVS successfully.");
  return true;
}

inline bool eraseConfig() {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) {
    Serial.println("[NVS] ERROR: Failed to open NVS for clearing!");
    return false;
  }
  prefs.clear();
  prefs.end();
  Serial.println("[NVS] All configuration erased completely from flash memory.");
  return true;
}

// Print active configuration to Serial
inline void printConfig(const EMSConfig &cfg) {
  Serial.println("\n========== ACTIVE EMS CONFIGURATION ==========");
  Serial.printf("Plant ID             : %s\n", cfg.plant_id);
  Serial.printf("Network Interface    : %s\n", cfg.net_interface);
  if (strcmp(cfg.net_interface, "ETH") == 0) {
    Serial.printf("Ethernet DHCP        : %s\n", cfg.eth_dhcp ? "Enabled" : "Disabled (Static)");
    if (!cfg.eth_dhcp) {
      Serial.printf("Ethernet Static IP   : %s\n", cfg.eth_ip);
      Serial.printf("Ethernet Gateway     : %s\n", cfg.eth_gateway);
      Serial.printf("Ethernet Subnet      : %s\n", cfg.eth_subnet);
      Serial.printf("Ethernet DNS         : %s\n", cfg.eth_dns);
    }
  }
  Serial.printf("Communication Proto  : %s\n", cfg.comm_proto);
  Serial.printf("Server Host          : %s\n", cfg.server_host);
  Serial.printf("Server Port          : %d\n", cfg.server_port);
  if (strcmp(cfg.comm_proto, "MQTT") == 0) {
    Serial.printf("MQTT Topic           : %s\n", cfg.mqtt_topic);
    Serial.printf("MQTT Username        : %s\n", strlen(cfg.mqtt_user) > 0 ? cfg.mqtt_user : "(none)");
  }
  Serial.printf("Poll Interval (s)    : %d\n", cfg.poll_interval_sec);
  Serial.printf("Float Endian Format  : %s\n", cfg.float_endian);
  Serial.println("--- Configured Modbus Slaves ---");
  Serial.printf("Total Configured     : %d meter(s)\n", cfg.slave_count);
  for (uint8_t i = 0; i < cfg.slave_count; i++) {
    const char* nm = (strlen(cfg.slaves[i].reg_name) > 0) ? cfg.slaves[i].reg_name : "kwh";
    Serial.printf("  Meter #%02d -> ID: %3d | Param: %-10s | Reg: %5d | Baud: %6lu | Parity: %s\n",
                  i + 1, cfg.slaves[i].id, nm, cfg.slaves[i].reg_address, 
                  cfg.slaves[i].baud_rate, cfg.slaves[i].parity);
  }
  Serial.println("==============================================\n");
}

// ===================================================================
// CSS & JAVASCRIPT FOR RESPONSIVE INDUSTRIAL PORTAL LAYOUT
// ===================================================================
const char CUSTOM_PORTAL_HEAD[] PROGMEM = R"rawliteral(
<style>
/* Base Theme & Industrial Aesthetics */
body {
  background: #ffffff !important;
  color: #111827 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
  margin: 0 !important;
  padding: 16px !important;
  min-height: 100vh;
}
.shell {
  display: flex !important;
  justify-content: center !important;
  align-items: flex-start !important;
  width: 100% !important;
}
.wrap {
  width: 100% !important;
  max-width: 600px !important;
  background: #ffffff !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 0 30px 0 !important;
  margin: 10px auto !important;
}
/* Laptop & Desktop Wide Viewport (Multi-Column Layout) */
@media (min-width: 920px) {
  .wrap {
    max-width: 1200px !important;
    width: 95% !important;
  }
  .ems-grid-2col {
    display: grid !important;
    grid-template-columns: 480px 1fr !important;
    gap: 22px !important;
    align-items: start !important;
  }
}
@media (max-width: 919px) {
  .ems-grid-2col {
    display: flex !important;
    flex-direction: column !important;
    gap: 16px !important;
  }
}

/* Industrial Header Bar - Sticky at Top */
.ems-header-bar {
  position: sticky !important;
  top: 10px !important;
  z-index: 100 !important;
  background: #ffffff !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 12px !important;
  padding: 14px 22px !important;
  margin-bottom: 20px !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
}
.ems-brand {
  display: flex !important;
  align-items: center !important;
  gap: 14px !important;
}
.ems-logo-icon {
  width: 44px !important;
  height: 44px !important;
  background: #333333 !important;
  border-radius: 10px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 1.5rem !important;
  color: #ffffff !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15) !important;
}
.ems-app-title {
  font-size: 1.25rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.5px !important;
  color: #111827 !important;
  line-height: 1.2 !important;
}
.ems-app-sub {
  font-size: 0.8rem !important;
  color: #6b7280 !important;
  margin-top: 3px !important;
}
.ems-status-pill {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  background: #f3f4f6 !important;
  border: 1px solid #e5e7eb !important;
  color: #374151 !important;
  padding: 6px 14px !important;
  border-radius: 20px !important;
  font-size: 0.82rem !important;
  font-weight: 600 !important;
}
.ems-btn-nav {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  background: #333333 !important;
  color: #ffffff !important;
  border: 1px solid #333333 !important;
  border-radius: 6px !important;
  padding: 6px 14px !important;
  font-size: 0.82rem !important;
  font-weight: 600 !important;
  text-decoration: none !important;
  cursor: pointer !important;
}
.ems-status-dot {
  width: 8px !important;
  height: 8px !important;
  border-radius: 50% !important;
  background: #10b981 !important;
  box-shadow: 0 0 6px #10b981 !important;
  animation: pulse-dot 2s infinite !important;
}
@keyframes pulse-dot {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

/* Card Styling */
.ems-card {
  background: #ffffff !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 10px !important;
  padding: 16px 18px !important;
  margin-bottom: 16px !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
}
.card-hdr {
  font-size: 0.92rem !important;
  font-weight: 700 !important;
  color: #111827 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  border-bottom: 1px solid #e5e7eb !important;
  padding-bottom: 8px !important;
  margin-bottom: 12px !important;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}
.helper-text {
  font-size: 0.78rem !important;
  color: #6b7280 !important;
  margin: -4px 0 10px !important;
}

/* Form Controls */
label {
  display: block !important;
  font-weight: 600 !important;
  font-size: 0.82rem !important;
  color: #374151 !important;
  margin: 8px 0 3px !important;
}
input[type="text"], input[type="password"], input[type="number"], select {
  width: 100% !important;
  background: #ffffff !important;
  color: #111827 !important;
  border: 1px solid #d1d5db !important;
  border-radius: 6px !important;
  padding: 8px 10px !important;
  font-size: 0.88rem !important;
  box-sizing: border-box !important;
  margin-bottom: 6px !important;
  transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
}
input:focus, select:focus {
  border-color: #333333 !important;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08) !important;
  outline: none !important;
}

/* Radio & Checkbox Options */
.opt-group {
  display: flex !important;
  gap: 10px !important;
  margin: 6px 0 10px !important;
  background: #f9fafb !important;
  padding: 8px 12px !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 6px !important;
}
.opt-label {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  cursor: pointer !important;
  font-weight: 600 !important;
  font-size: 0.85rem !important;
  color: #111827 !important;
  margin: 0 !important;
}
.opt-label input[type="radio"], .opt-label input[type="checkbox"] {
  width: auto !important;
  margin: 0 !important;
  cursor: pointer !important;
}

/* Scanned WiFi Box */
.wifi-scan-card {
  background: #f9fafb !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 8px !important;
  padding: 10px 12px !important;
  margin: 10px 0 !important;
}
.scan-card-header {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  font-size: 0.82rem !important;
  font-weight: 700 !important;
  color: #111827 !important;
  margin-bottom: 8px !important;
  border-bottom: 1px solid #e5e7eb !important;
  padding-bottom: 5px !important;
}
.scan-card-sub {
  font-size: 0.72rem !important;
  font-weight: 400 !important;
  color: #6b7280 !important;
}
.wifi-scan-scroll {
  max-height: 180px !important;
  overflow-y: auto !important;
  padding-right: 4px !important;
}
.wifi-scan-scroll::-webkit-scrollbar {
  width: 5px;
}
.wifi-scan-scroll::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}
.wifi-net-row {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  background: #ffffff !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 5px !important;
  padding: 7px 10px !important;
  margin-bottom: 5px !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}
.wifi-net-row:hover {
  background: #f3f4f6 !important;
  border-color: #d1d5db !important;
}
.wifi-net-row.active-net {
  background: #e5e7eb !important;
  border-color: #9ca3af !important;
}
.wifi-net-row a {
  color: #111827 !important;
  text-decoration: none !important;
  font-weight: 600 !important;
  font-size: 0.85rem !important;
}
.wifi-cred-box {
  background: #f9fafb !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 8px !important;
  padding: 10px 12px !important;
  margin-top: 8px !important;
}

/* Modbus RS485 Slaves */
.slave-card {
  background: #f9fafb !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 8px !important;
  padding: 10px 12px !important;
  margin-bottom: 10px !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03) !important;
}
.slave-hdr {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  font-weight: 700 !important;
  font-size: 0.84rem !important;
  margin-bottom: 8px !important;
  color: #111827 !important;
  border-bottom: 1px solid #e5e7eb !important;
  padding-bottom: 4px !important;
}
.btn-del {
  width: auto !important;
  background: #dc2626 !important;
  color: #ffffff !important;
  border: none !important;
  border-radius: 4px !important;
  padding: 3px 8px !important;
  cursor: pointer !important;
  font-size: 0.75rem !important;
  font-weight: 700 !important;
}
.btn-add {
  width: 100% !important;
  background: #333333 !important;
  color: #ffffff !important;
  border: none !important;
  border-radius: 6px !important;
  padding: 10px !important;
  margin: 10px 0 !important;
  cursor: pointer !important;
  font-weight: 700 !important;
  font-size: 0.9rem !important;
}
.grid-slave {
  display: grid !important;
  grid-template-columns: 0.9fr 1.3fr 1.1fr 1fr 0.9fr !important;
  gap: 8px !important;
}
.grid-slave div {
  padding: 0 !important;
  margin: 0 !important;
}
.grid-slave label {
  font-size: 0.72rem !important;
  color: #6b7280 !important;
  margin-top: 2px !important;
}
.grid-slave input, .grid-slave select {
  font-size: 0.84rem !important;
  padding: 6px 8px !important;
  margin-bottom: 0 !important;
}

/* Action Buttons & 2-Column Sticky Footer */
.ems-footer-actions-2col {
  position: sticky !important;
  bottom: 10px !important;
  z-index: 100 !important;
  background: rgba(255, 255, 255, 0.96) !important;
  backdrop-filter: blur(8px) !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 12px !important;
  padding: 12px 16px !important;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.08) !important;
  display: grid !important;
  grid-template-columns: 1.15fr 1fr !important;
  gap: 14px !important;
  margin-top: 24px !important;
  margin-bottom: 10px !important;
  align-items: center !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
.ems-col-save {
  width: 100% !important;
}
.actions-footer {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
}
.btn-save {
  width: 100% !important;
  height: 48px !important;
  background: #333333 !important;
  color: #ffffff !important;
  border: none !important;
  border-radius: 8px !important;
  padding: 12px 16px !important;
  font-weight: 700 !important;
  font-size: 0.95rem !important;
  cursor: pointer !important;
  box-shadow: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
}
.ems-col-aux {
  display: flex !important;
  gap: 10px !important;
  width: 100% !important;
}
.aux-actions, .actions {
  display: flex !important;
  margin: 0 !important;
  padding: 0 !important;
  flex: 1 !important;
  width: 100% !important;
}
.ems-col-aux form {
  width: 100% !important;
  margin: 0 !important;
  display: flex !important;
}
.btn-aux {
  width: 100% !important;
  height: 48px !important;
  background: #4b5563 !important;
  color: #ffffff !important;
  border: 1px solid #4b5563 !important;
  border-radius: 8px !important;
  padding: 10px 12px !important;
  font-size: 0.88rem !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
}

@media (max-width: 768px) {
  .ems-footer-actions-2col {
    grid-template-columns: 1fr !important;
    gap: 10px !important;
  }
  .ems-col-aux {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
  }
}

/* Main Menu Buttons (when on / page) */
.ems-menu-grid {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px 18px !important;
  margin-top: 10px !important;
  margin-bottom: 20px !important;
  width: 100% !important;
}
.ems-menu-grid form {
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  width: 100% !important;
}
.ems-menu-grid form > button {
  width: 100% !important;
  margin: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 14px 16px !important;
  font-size: 0.95rem !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
  box-sizing: border-box !important;
}
@media (max-width: 640px) {
  .ems-menu-grid {
    grid-template-columns: 1fr !important;
    gap: 10px !important;
  }
}

form > button {
  background: #333333 !important;
  color: #ffffff !important;
  border: 1px solid #333333 !important;
  border-radius: 8px !important;
  padding: 12px !important;
  font-size: 0.95rem !important;
  font-weight: 600 !important;
  cursor: pointer !important;
}
form > button.D {
  background: #991b1b !important;
  border: 1px solid #dc2626 !important;
}

/* Global button hover reset - keep static colors without hover changes */
button:hover, input[type='button']:hover, input[type='submit']:hover, 
.btn-save:hover, .btn-add:hover, .btn-del:hover, .btn-aux:hover, .ems-btn-nav:hover {
  transform: none !important;
  box-shadow: none !important;
  filter: none !important;
  outline: none !important;
}

/* Success message & Standalone Return Button */
.msg.S {
  background: #f0fdf4 !important;
  border: 1px solid #bbf7d0 !important;
  border-left: 4px solid #16a34a !important;
  color: #166534 !important;
  border-radius: 8px !important;
  padding: 22px 26px !important;
  margin: 30px auto 20px !important;
  max-width: 540px !important;
  text-align: center !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
}
.msg.S h4 {
  font-size: 1.25rem !important;
  font-weight: 700 !important;
  color: #15803d !important;
  margin: 0 0 8px !important;
}
.msg.S p {
  color: #166534 !important;
  font-size: 0.92rem !important;
  margin: 0 !important;
}

/* Standalone return button (when outside 2-column footer) */
.wrap > .actions, .actions {
  max-width: 320px !important;
  margin: 16px auto !important;
  width: 100% !important;
  display: flex !important;
  justify-content: center !important;
}
.actions .btn-aux {
  max-width: 280px !important;
  margin: 0 auto !important;
}

/* Clean overrides */
.hero { display: none !important; }
.msg:not(.S) { display: none !important; }
</style>

<script>
// Dynamic Slave Meters State
var slaves = [];

function initSlaves(raw) {
  slaves = [];
  if (raw && raw.length > 0) {
    var parts = raw.split(';');
    for (var i = 0; i < parts.length; i++) {
      var item = parts[i].split(':');
      if (item.length === 4) {
        slaves.push({
          id: parseInt(item[0]) || (i + 1),
          name: 'kwh',
          reg: parseInt(item[1]) || 2699,
          baud: parseInt(item[2]) || 9600,
          parity: item[3] || '8E1'
        });
      } else if (item.length >= 5) {
        slaves.push({
          id: parseInt(item[0]) || (i + 1),
          name: item[1] || 'kwh',
          reg: parseInt(item[2]) || 2699,
          baud: parseInt(item[3]) || 9600,
          parity: item[4] || '8E1'
        });
      }
    }
  }
  if (slaves.length === 0) {
    slaves.push({ id: 1, name: 'kwh', reg: 2699, baud: 9600, parity: '8E1' });
  }
  renderSlaves();
}

function renderSlaves() {
  var container = document.getElementById('slaves_container');
  if (!container) return;
  var html = '';
  var bauds = [9600, 19200, 38400, 115200];
  var pars = ['8E1', '8N1', '8O1'];

  for (var i = 0; i < slaves.length; i++) {
    html += "<div class='slave-card'>";
    html += "<div class='slave-hdr'><span>Meter #" + (i + 1) + " - Slave ID & Parameters</span>";
    if (slaves.length > 1) {
      html += "<button type='button' class='btn-del' onclick='removeSlave(" + i + ")'>✕ Delete</button>";
    }
    html += "</div>";

    html += "<div class='grid-slave'>";
    html += "<div><label>Slave ID</label><input type='number' min='1' max='247' value='" + slaves[i].id + "' onchange='updSlave(" + i + ",\"id\",this.value)'></div>";
    html += "<div><label>Param Name</label><input type='text' maxlength='15' placeholder='e.g. kwh, Freq_Hz' value='" + (slaves[i].name || 'kwh') + "' onchange='updSlave(" + i + ",\"name\",this.value)'></div>";
    html += "<div><label>Register</label><input type='number' min='1' max='65535' value='" + slaves[i].reg + "' onchange='updSlave(" + i + ",\"reg\",this.value)'></div>";
    
    html += "<div><label>Baud</label><select onchange='updSlave(" + i + ",\"baud\",this.value)'>";
    for (var b = 0; b < bauds.length; b++) {
      html += "<option value='" + bauds[b] + "'" + (slaves[i].baud == bauds[b] ? " selected" : "") + ">" + bauds[b] + "</option>";
    }
    html += "</select></div>";

    html += "<div><label>Parity</label><select onchange='updSlave(" + i + ",\"parity\",this.value)'>";
    for (var p = 0; p < pars.length; p++) {
      html += "<option value='" + pars[p] + "'" + (slaves[i].parity == pars[p] ? " selected" : "") + ">" + pars[p] + "</option>";
    }
    html += "</select></div>";
    html += "</div></div>";
  }

  container.innerHTML = html;
  syncHidden();
}

function addSlave() {
  var nextId = 1;
  if (slaves.length > 0) {
    nextId = parseInt(slaves[slaves.length - 1].id) + 1;
    if (nextId > 247) nextId = slaves.length + 1;
  }
  slaves.push({ id: nextId, name: 'kwh', reg: 2699, baud: 9600, parity: '8E1' });
  renderSlaves();
}

function removeSlave(index) {
  if (slaves.length > 1) {
    slaves.splice(index, 1);
    renderSlaves();
  }
}

function updSlave(index, field, val) {
  if (field === 'id' || field === 'reg' || field === 'baud') {
    slaves[index][field] = parseInt(val) || 0;
  } else {
    slaves[index][field] = val;
  }
  syncHidden();
}

function syncHidden() {
  var out = [];
  for (var i = 0; i < slaves.length; i++) {
    var nm = (slaves[i].name || 'kwh').trim().replace(/[:;]/g, '');
    if (!nm) nm = 'kwh';
    out.push(slaves[i].id + ':' + nm + ':' + slaves[i].reg + ':' + slaves[i].baud + ':' + slaves[i].parity);
  }
  var hidden = document.getElementById('slaves_cfg');
  if (hidden) hidden.value = out.join(';');
}

function toggleNet(val) {
  var ethSec = document.getElementById('eth_fields');
  var wifiHost = document.getElementById('wifi_host_container');
  var scanDiv = document.querySelector('.aux-actions');
  var hidden = document.getElementById('net_if');
  if (hidden) hidden.value = val;
  if (ethSec) ethSec.style.display = (val === 'ETH') ? 'block' : 'none';
  if (wifiHost) wifiHost.style.display = (val === 'WIFI') ? 'block' : 'none';
  if (scanDiv) scanDiv.style.display = (val === 'WIFI') ? 'flex' : 'none';
}

function toggleDhcp(checked) {
  var staticSec = document.getElementById('static_ip_fields');
  var hidden = document.getElementById('eth_dhcp');
  if (hidden) hidden.value = checked ? '1' : '0';
  if (staticSec) staticSec.style.display = checked ? 'none' : 'block';
}

function toggleProto(val) {
  var mqSec = document.getElementById('mqtt_fields');
  var hidden = document.getElementById('comm_proto');
  if (hidden) hidden.value = val;
  if (mqSec) mqSec.style.display = (val === 'MQTT') ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', function() {
  // 1. Build & Insert Header Bar
  var wrap = document.querySelector('.wrap');
  if (wrap) {
    var statusText = 'Configuration Mode';
    var msgS = document.querySelector('.msg.S');
    if (msgS) {
      var txt = msgS.innerText || msgS.textContent;
      if (txt.indexOf('Connected') !== -1) {
        var lines = txt.split('\n').map(function(s){return s.trim();}).filter(Boolean);
        if (lines.length >= 3) {
          statusText = 'Connected: ' + lines[1] + ' (' + lines[2].replace('IP ','') + ')';
        } else {
          statusText = lines.join(' - ');
        }
      }
    }

    var isHome = (window.location.pathname === '/' || window.location.pathname === '');
    var navHomeBtn = '';
    if (!isHome) {
      navHomeBtn = "<a href='/' class='ems-btn-nav'>Home Menu</a>";
    }

    var hdr = document.createElement('div');
    hdr.className = 'ems-header-bar';
    hdr.innerHTML = "<div class='ems-brand'>"
      + "<div><div class='ems-app-title'>GATEWAY CONFIGURATION PORTAL</div>"
      + "<div class='ems-app-sub'>Multi-Meter Energy Management</div></div>"
      + "</div>"
      + "<div style='display:flex;align-items:center;gap:10px;'>"
      + navHomeBtn
      + "<div class='ems-status-pill'><span class='ems-status-dot'></span><span>" + statusText + "</span></div>"
      + "</div>";
    wrap.insertBefore(hdr, wrap.firstChild);

    // 2. Reorganize Home Portal Menu into a 2-Column Grid (3 rows x 2 columns)
    if (isHome) {
      if (msgS) msgS.style.display = 'none';
      var menuForms = Array.from(wrap.querySelectorAll('form:not(.panel-form)'));
      if (menuForms.length > 0) {
        var menuGrid = document.createElement('div');
        menuGrid.className = 'ems-menu-grid';
        wrap.insertBefore(menuGrid, menuForms[0]);
        menuForms.forEach(function(f) {
          menuGrid.appendChild(f);
        });
        var strays = wrap.querySelectorAll('br, hr');
        strays.forEach(function(el) {
          if (el.parentNode === wrap) el.remove();
        });
      }
    }
  }

  // 3. Relocate Scanned WiFi box & WiFi credentials into #wifi_host_container
  var wifiHost = document.getElementById('wifi_host_container');
  var scanBox = document.getElementById('wifi_scan_box');
  var wifiFields = document.getElementById('wifi_fields');
  if (wifiHost) {
    if (scanBox) wifiHost.appendChild(scanBox);
    if (wifiFields) wifiHost.appendChild(wifiFields);
  }

  // 3. Highlight selected WiFi network item on click
  var netRows = document.querySelectorAll('.wifi-net-row');
  netRows.forEach(function(row) {
    row.addEventListener('click', function() {
      netRows.forEach(function(r) { r.classList.remove('active-net'); });
      row.classList.add('active-net');
    });
  });

  // 4. Laptop / Desktop 2-Column Layout Re-organization
  var form = document.querySelector('form.panel-form');
  var cardDev = document.getElementById('card_device');
  var cardNet = document.getElementById('card_net');
  var cardProto = document.getElementById('card_proto');
  var cardEndian = document.getElementById('card_endian');
  var cardSlaves = document.getElementById('card_slaves');
  var saveFoot = document.querySelector('.actions-footer');

  if (form && cardDev && cardNet && cardProto && cardSlaves) {
    var grid = document.createElement('div');
    grid.className = 'ems-grid-2col';

    var colLeft = document.createElement('div');
    colLeft.className = 'ems-col-left';
    colLeft.appendChild(cardDev);
    colLeft.appendChild(cardNet);
    colLeft.appendChild(cardProto);

    var colRight = document.createElement('div');
    colRight.className = 'ems-col-right';
    if (cardEndian) colRight.appendChild(cardEndian);
    colRight.appendChild(cardSlaves);

    grid.appendChild(colLeft);
    grid.appendChild(colRight);

    if (saveFoot) {
      form.insertBefore(grid, saveFoot);
    } else {
      form.appendChild(grid);
    }
  }

  // 5. Reorganize bottom action buttons into 2 Columns (Save | Rescan + Return)
  var scanDiv = document.querySelector('.aux-actions');
  var backDiv = document.querySelector('.actions');
  if (saveFoot && (scanDiv || backDiv)) {
    if (form) form.id = 'panel_form';
    var saveBtn = saveFoot.querySelector('button');
    if (saveBtn) {
      saveBtn.setAttribute('form', 'panel_form');
      saveBtn.addEventListener('click', function(e) {
        if (form && !e.defaultPrevented) {
          if (form.reportValidity && !form.reportValidity()) return;
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });
    }

    var actionsWrap = document.createElement('div');
    actionsWrap.className = 'ems-footer-actions-2col';

    var colSave = document.createElement('div');
    colSave.className = 'ems-col-save';
    colSave.appendChild(saveFoot);

    var colAux = document.createElement('div');
    colAux.className = 'ems-col-aux';
    if (scanDiv) colAux.appendChild(scanDiv);
    if (backDiv) colAux.appendChild(backDiv);

    actionsWrap.appendChild(colSave);
    actionsWrap.appendChild(colAux);

    var msgBox = document.querySelector('.msg');
    var wrap = document.querySelector('.wrap');
    if (msgBox && msgBox.parentNode) {
      msgBox.parentNode.insertBefore(actionsWrap, msgBox);
    } else if (form && form.parentNode) {
      form.parentNode.insertBefore(actionsWrap, form.nextSibling);
    } else if (wrap) {
      wrap.appendChild(actionsWrap);
    }
  }

  // 6. Initialize Slaves
  var hSlaves = document.getElementById('slaves_cfg');
  if (hSlaves) initSlaves(hSlaves.value);

  // 6. Enforce initial toggle state
  var hNet = document.getElementById('net_if');
  if (hNet) toggleNet(hNet.value || 'ETH');
  var hDhcp = document.getElementById('eth_dhcp');
  if (hDhcp) toggleDhcp(hDhcp.value === '1');
  var hProto = document.getElementById('comm_proto');
  if (hProto) toggleProto(hProto.value || 'UDP');
});
</script>
)rawliteral";

// ===================================================================
// WIFIMANAGER CONFIGURATION PORTAL RUNNER
// ===================================================================
inline bool startEMSConfigPortal(EMSConfig &cfg, const char* apName = nullptr, const char* apPassword = nullptr) {
  WiFiManager wm;

  // Custom UI Title & ultra-compact CSS + Script injection
  wm.setCustomHeadElement(CUSTOM_PORTAL_HEAD);
  wm.setTitle("EMS Energy Logger Configuration");

  // Keep portal open indefinitely until user clicks Save
  wm.setConfigPortalTimeout(0);           // 0 = NEVER timeout, stays open until configured
  wm.setConfigPortalBlocking(true);       // Ensure synchronous blocking portal loop
  wm.setSaveConnect(false);               // Do not force WiFi connect on save (allows ETH mode)
  wm.setConnectTimeout(4);                // Fast 4s safety timeout if network connect is attempted
  wm.setSaveConnectTimeout(4);            // Fast 4s timeout
  wm.setBreakAfterConfig(true);           // Exit immediately once Save is processed
  wm.setShowBack(true);                   // Ensure back button to Home/Menu is enabled
  wm.setDebugOutput(true);                // Show WiFiManager diagnostics on Serial Monitor
  wm.setRemoveDuplicateAPs(true);         // Speeds up WiFi scan list
  wm.setScanDispPerc(false);              // Reduces network scanning overhead

  // Main portal page menu: 2 rows x 2 columns (4 buttons total)
  // Row 1: Update Existing Configuration | Debug
  // Row 2: Exit Portal                   | Factory Reset
  const char* menu[] = {"wifi", "info", "exit", "erase"};
  wm.setMenu(menu, sizeof(menu) / sizeof(menu[0]));

  // Static string buffers (avoids consuming stack memory)
  static char buf_plant_id[32];
  static char buf_net_if[8];
  static char buf_eth_dhcp[4];
  static char buf_eth_ip[20];
  static char buf_eth_gw[20];
  static char buf_eth_sn[20];
  static char buf_eth_dns[20];

  static char buf_comm_proto[8];
  static char buf_srv_host[64];
  static char buf_srv_port[8];
  static char buf_mq_topic[64];
  static char buf_mq_user[32];
  static char buf_mq_pass[32];
  static char buf_interval[8];
  static char buf_float_endian[8];
  static char buf_slaves_cfg[1024];

  // Populate buffers with current settings
  strlcpy(buf_plant_id, cfg.plant_id, sizeof(buf_plant_id));
  strlcpy(buf_net_if, cfg.net_interface, sizeof(buf_net_if));
  snprintf(buf_eth_dhcp, sizeof(buf_eth_dhcp), "%d", cfg.eth_dhcp ? 1 : 0);
  strlcpy(buf_eth_ip, cfg.eth_ip, sizeof(buf_eth_ip));
  strlcpy(buf_eth_gw, cfg.eth_gateway, sizeof(buf_eth_gw));
  strlcpy(buf_eth_sn, cfg.eth_subnet, sizeof(buf_eth_sn));
  strlcpy(buf_eth_dns, cfg.eth_dns, sizeof(buf_eth_dns));

  strlcpy(buf_comm_proto, cfg.comm_proto, sizeof(buf_comm_proto));
  strlcpy(buf_srv_host, cfg.server_host, sizeof(buf_srv_host));
  snprintf(buf_srv_port, sizeof(buf_srv_port), "%d", cfg.server_port);
  strlcpy(buf_mq_topic, cfg.mqtt_topic, sizeof(buf_mq_topic));
  strlcpy(buf_mq_user, cfg.mqtt_user, sizeof(buf_mq_user));
  strlcpy(buf_mq_pass, cfg.mqtt_pass, sizeof(buf_mq_pass));
  snprintf(buf_interval, sizeof(buf_interval), "%d", cfg.poll_interval_sec);
  strlcpy(buf_float_endian, cfg.float_endian, sizeof(buf_float_endian));

  serializeSlaves(cfg, buf_slaves_cfg, sizeof(buf_slaves_cfg));

  // --- Visual Section 1: Device Identification Card ---
  WiFiManagerParameter sec_dev_head("<div class='ems-card' id='card_device'><div class='card-hdr'>🏢 Device Identification</div>");
  WiFiManagerParameter p_plant_id("plant_id", "Plant / Device ID", buf_plant_id, sizeof(buf_plant_id) - 1, "placeholder='e.g. 202326' required");
  WiFiManagerParameter sec_dev_foot("</div>");

  // --- Visual Section 2: Network Interface Card ---
  bool isEth = (strcmp(cfg.net_interface, "ETH") == 0);
  String netHtml = "<div class='ems-card' id='card_net'><div class='card-hdr'>🌐 Network Interface</div>"
                   "<div class='opt-group'>"
                   "<label class='opt-label'><input type='radio' name='r_net_if' value='ETH' onchange='toggleNet(this.value)' " + String(isEth ? "checked" : "") + "> Ethernet (W5500 SPI)</label>"
                   "<label class='opt-label'><input type='radio' name='r_net_if' value='WIFI' onchange='toggleNet(this.value)' " + String(!isEth ? "checked" : "") + "> WiFi (ESP32)</label>"
                   "</div>";
  WiFiManagerParameter p_net_ui(netHtml.c_str());
  WiFiManagerParameter p_net_if("net_if", "", buf_net_if, sizeof(buf_net_if) - 1, "type='hidden'");

  // Ethernet DHCP & Static IP Section
  String dhcpHtml = "<div id='eth_fields' style='display:" + String(isEth ? "block" : "none") + ";'>"
                    "<div class='opt-group'>"
                    "<label class='opt-label'><input type='checkbox' id='chk_dhcp' onchange='toggleDhcp(this.checked)' " + String(cfg.eth_dhcp ? "checked" : "") + "> Enable Ethernet DHCP (Automatic IP)</label>"
                    "</div>"
                    "<div id='static_ip_fields' style='display:" + String(cfg.eth_dhcp ? "none" : "block") + ";'>";
  WiFiManagerParameter p_eth_ui_head(dhcpHtml.c_str());
  WiFiManagerParameter p_eth_dhcp("eth_dhcp", "", buf_eth_dhcp, sizeof(buf_eth_dhcp) - 1, "type='hidden'");
  WiFiManagerParameter p_eth_ip("eth_ip", "Ethernet Static IP", buf_eth_ip, sizeof(buf_eth_ip) - 1, "placeholder='192.168.0.229'");
  WiFiManagerParameter p_eth_gw("eth_gw", "Ethernet Gateway", buf_eth_gw, sizeof(buf_eth_gw) - 1, "placeholder='192.168.0.1'");
  WiFiManagerParameter p_eth_sn("eth_sn", "Ethernet Subnet", buf_eth_sn, sizeof(buf_eth_sn) - 1, "placeholder='255.255.255.0'");
  WiFiManagerParameter p_eth_dns("eth_dns", "Ethernet DNS", buf_eth_dns, sizeof(buf_eth_dns) - 1, "placeholder='8.8.8.8'");
  WiFiManagerParameter p_eth_ui_foot("</div></div>");

  // Placeholder container for WiFi (JS relocates #wifi_scan_box & #wifi_fields inside here)
  String wifiHostHtml = "<div id='wifi_host_container' style='display:" + String(!isEth ? "block" : "none") + ";'></div></div>";
  WiFiManagerParameter p_wifi_host(wifiHostHtml.c_str());

  // --- Visual Section 3: Telemetry Protocol Card ---
  bool isUdp = (strcmp(cfg.comm_proto, "UDP") == 0);
  String protoHtml = "<div class='ems-card' id='card_proto'><div class='card-hdr'>📡 Server & Telemetry</div>"
                     "<div class='opt-group'>"
                     "<label class='opt-label'><input type='radio' name='r_proto' value='UDP' onchange='toggleProto(this.value)' " + String(isUdp ? "checked" : "") + "> UDP Telemetry</label>"
                     "<label class='opt-label'><input type='radio' name='r_proto' value='MQTT' onchange='toggleProto(this.value)' " + String(!isUdp ? "checked" : "") + "> MQTT Broker</label>"
                     "</div>";
  WiFiManagerParameter p_proto_ui(protoHtml.c_str());
  WiFiManagerParameter p_comm_proto("comm_proto", "", buf_comm_proto, sizeof(buf_comm_proto) - 1, "type='hidden'");

  WiFiManagerParameter p_srv_host("srv_host", "Server Host / IP", buf_srv_host, sizeof(buf_srv_host) - 1, "placeholder='e.g. 192.168.0.159' required");
  WiFiManagerParameter p_srv_port("srv_port", "Server Port", buf_srv_port, sizeof(buf_srv_port) - 1, "type='number' placeholder='10011' required");

  // MQTT optional fields
  String mqttHead = "<div id='mqtt_fields' style='display:" + String(!isUdp ? "block" : "none") + ";'>";
  WiFiManagerParameter p_mq_head(mqttHead.c_str());
  WiFiManagerParameter p_mq_topic("mq_topic", "MQTT Topic", buf_mq_topic, sizeof(buf_mq_topic) - 1, "placeholder='ems/fuso/energy'");
  WiFiManagerParameter p_mq_user("mq_user", "MQTT Username (optional)", buf_mq_user, sizeof(buf_mq_user) - 1, "placeholder='Username'");
  WiFiManagerParameter p_mq_pass("mq_pass", "MQTT Password (optional)", buf_mq_pass, sizeof(buf_mq_pass) - 1, "type='password' placeholder='Password'");
  WiFiManagerParameter p_mq_foot("</div>");

  WiFiManagerParameter p_interval("interval", "Telemetry Scan Interval (seconds)", buf_interval, sizeof(buf_interval) - 1, "type='number' min='5' max='3600' required");
  WiFiManagerParameter p_proto_foot("</div>");

  // --- Visual Section 4: Dynamic Modbus Slaves Card & Float Endianness ---
  String endianABCD = (strcmp(cfg.float_endian, "ABCD") == 0) ? "selected" : "";
  String endianCDAB = (strcmp(cfg.float_endian, "CDAB") == 0) ? "selected" : "";
  String endianBADC = (strcmp(cfg.float_endian, "BADC") == 0) ? "selected" : "";
  String endianDCBA = (strcmp(cfg.float_endian, "DCBA") == 0) ? "selected" : "";

  String slavesUi = "<div class='ems-card' id='card_endian'><div class='card-hdr'>Float Endianness Type</div>"
                    "<div style='background:#f9fafb;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;'>"
                    "<label for='flt_endian_sel' style='margin-top:0;color:#374151;'>Modbus 32-bit Float Endian Format</label>"
                    "<select id='flt_endian_sel' onchange='document.getElementById(\"flt_endian\").value=this.value'>"
                    "<option value='ABCD' " + endianABCD + ">ABCD - Big-Endian (Normal / Motorola) [Standard]</option>"
                    "<option value='CDAB' " + endianCDAB + ">CDAB - Word-Swapped (Little-Endian Word)</option>"
                    "<option value='BADC' " + endianBADC + ">BADC - Byte-Swapped (Mid-Endian)</option>"
                    "<option value='DCBA' " + endianDCBA + ">DCBA - True Little-Endian (Intel)</option>"
                    "</select>"
                    "<div class='helper-text' style='margin:4px 0 0;color:#6b7280;'>All configured meters will decode 32-bit float registers using this format.</div>"
                    "</div></div>"
                    "<div class='ems-card' id='card_slaves'><div class='card-hdr'>Modbus RS485 Slaves / Meters</div>"
                    "<div class='helper-text'>Configure individual meters with unique Slave ID, Param Name, Register, Baud & Parity:</div>"
                    "<div id='slaves_container'></div>"
                    "<button type='button' class='btn-add' onclick='addSlave()'>+ Add Meter (N+1)</button>"
                    "</div>";
  WiFiManagerParameter p_slaves_ui(slavesUi.c_str());
  WiFiManagerParameter p_flt_endian("flt_endian", "", buf_float_endian, sizeof(buf_float_endian) - 1, "type='hidden'");
  WiFiManagerParameter p_slaves_cfg("slaves_cfg", "", buf_slaves_cfg, sizeof(buf_slaves_cfg) - 1, "type='hidden'");

  // Add parameters in logical order to portal
  wm.addParameter(&sec_dev_head);
  wm.addParameter(&p_plant_id);
  wm.addParameter(&sec_dev_foot);

  // Network Interface
  wm.addParameter(&p_net_ui);
  wm.addParameter(&p_net_if);
  wm.addParameter(&p_eth_ui_head);
  wm.addParameter(&p_eth_dhcp);
  wm.addParameter(&p_eth_ip);
  wm.addParameter(&p_eth_gw);
  wm.addParameter(&p_eth_sn);
  wm.addParameter(&p_eth_dns);
  wm.addParameter(&p_eth_ui_foot);
  wm.addParameter(&p_wifi_host);

  // Protocol & Server
  wm.addParameter(&p_proto_ui);
  wm.addParameter(&p_comm_proto);
  wm.addParameter(&p_srv_host);
  wm.addParameter(&p_srv_port);
  wm.addParameter(&p_mq_head);
  wm.addParameter(&p_mq_topic);
  wm.addParameter(&p_mq_user);
  wm.addParameter(&p_mq_pass);
  wm.addParameter(&p_mq_foot);
  wm.addParameter(&p_interval);
  wm.addParameter(&p_proto_foot);

  // Dynamic Slaves & Endian
  wm.addParameter(&p_slaves_ui);
  wm.addParameter(&p_flt_endian);
  wm.addParameter(&p_slaves_cfg);

  // Track if configuration form was submitted by user
  bool formSubmitted = false;

  auto captureAndSave = [&]() {
    if (strlen(p_plant_id.getValue()) > 0) strlcpy(cfg.plant_id, p_plant_id.getValue(), sizeof(cfg.plant_id));
    if (strlen(p_net_if.getValue()) > 0) {
      String ifStr = p_net_if.getValue();
      ifStr.trim();
      ifStr.toUpperCase();
      strlcpy(cfg.net_interface, ifStr.c_str(), sizeof(cfg.net_interface));
    }
    cfg.eth_dhcp = (atoi(p_eth_dhcp.getValue()) == 1);
    if (strlen(p_eth_ip.getValue()) > 0) strlcpy(cfg.eth_ip, p_eth_ip.getValue(), sizeof(cfg.eth_ip));
    if (strlen(p_eth_gw.getValue()) > 0) strlcpy(cfg.eth_gateway, p_eth_gw.getValue(), sizeof(cfg.eth_gateway));
    if (strlen(p_eth_sn.getValue()) > 0) strlcpy(cfg.eth_subnet, p_eth_sn.getValue(), sizeof(cfg.eth_subnet));
    if (strlen(p_eth_dns.getValue()) > 0) strlcpy(cfg.eth_dns, p_eth_dns.getValue(), sizeof(cfg.eth_dns));

    if (strlen(p_comm_proto.getValue()) > 0) {
      String protoStr = p_comm_proto.getValue();
      protoStr.trim();
      protoStr.toUpperCase();
      strlcpy(cfg.comm_proto, protoStr.c_str(), sizeof(cfg.comm_proto));
    }
    if (strlen(p_srv_host.getValue()) > 0) strlcpy(cfg.server_host, p_srv_host.getValue(), sizeof(cfg.server_host));
    if (strlen(p_srv_port.getValue()) > 0) cfg.server_port = (uint16_t)atoi(p_srv_port.getValue());
    if (strlen(p_mq_topic.getValue()) > 0) strlcpy(cfg.mqtt_topic, p_mq_topic.getValue(), sizeof(cfg.mqtt_topic));
    strlcpy(cfg.mqtt_user, p_mq_user.getValue(), sizeof(cfg.mqtt_user));
    strlcpy(cfg.mqtt_pass, p_mq_pass.getValue(), sizeof(cfg.mqtt_pass));
    if (strlen(p_interval.getValue()) > 0) cfg.poll_interval_sec = (uint16_t)atoi(p_interval.getValue());

    if (strlen(p_flt_endian.getValue()) > 0) {
      strlcpy(cfg.float_endian, p_flt_endian.getValue(), sizeof(cfg.float_endian));
    }

    // Deserialize custom per-slave configuration from hidden input
    if (strlen(p_slaves_cfg.getValue()) > 0) {
      deserializeSlaves(cfg, p_slaves_cfg.getValue());
    }

    // Persist all settings into NVS flash memory immediately
    saveConfig(cfg);
    printConfig(cfg);
    formSubmitted = true;
    Serial.println("[PORTAL] Configuration captured and written to NVS flash successfully!");
  };

  // Register callback so parameters are saved immediately on HTTP POST /wifisave
  wm.setSaveParamsCallback(captureAndSave);

  // Determine AP SSID
  char ssid[40];
  if (apName != nullptr && strlen(apName) > 0) {
    strlcpy(ssid, apName, sizeof(ssid));
  } else {
    snprintf(ssid, sizeof(ssid), "EMS_CONFIG_%s", cfg.plant_id);
  }

  Serial.println("\n---------------------------------------------------");
  Serial.printf("[AP MODE] Starting WiFiManager Access Point: %s\n", ssid);
  Serial.println("[AP MODE] Connect your smartphone / PC to this WiFi.");
  Serial.println("[AP MODE] Navigate to http://192.168.4.1 to configure parameters.");
  Serial.println("---------------------------------------------------\n");

  // Start the portal
  bool res = false;
  if (apPassword != nullptr && strlen(apPassword) >= 8) {
    res = wm.startConfigPortal(ssid, apPassword);
  } else {
    res = wm.startConfigPortal(ssid); // Open AP
  }

  // If form was submitted or portal completed with success, return true
  if (formSubmitted || res) {
    if (!formSubmitted) {
      captureAndSave();
    }
    Serial.println("[AP MODE] Parameters updated and verified in NVS!");
    return true;
  }

  Serial.println("[AP MODE] Portal closed without saving.");
  return false;
}

#endif // EMS_CONFIG_MANAGER_H
