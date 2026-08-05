const plantsGridView = document.getElementById("plantsGridView");
const deviceManagerModal = document.getElementById("deviceManagerModal");
const deviceForm = document.getElementById("deviceForm");
const devError = document.getElementById("devError");
const deviceModalTitle = document.getElementById("deviceModalTitle");

let globalPlants = [];
let globalGroupedDevices = {};
let globalDevices = [];
let globalHeartbeats = [];
let heartbeatRefreshTimer = null;

// ================= INITIALIZATION =================

document.addEventListener("DOMContentLoaded", () => {
    loadAllDevices();
    loadDiscoveredDevices();
    setupWebSocket();
});

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/heartbeats`);
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === "heartbeat_updated") {
                loadDiscoveredDevices();
            }
        } catch (e) {
            console.error("WebSocket message error:", e);
        }
    };
    
    ws.onclose = () => {
        // Attempt to reconnect after 5 seconds if connection is lost
        setTimeout(setupWebSocket, 5000);
    };
}

// ================= DISCOVERED DEVICES PANEL =================

window.loadDiscoveredDevices = async function() {
    const list = document.getElementById("discoveredDevicesList");
    const badge = document.getElementById("deviceCountBadge");
    try {
        const res = await fetch("/api/device_heartbeats");
        if (!res.ok) throw new Error("Not logged in");
        const devices = await res.json();
        window.globalHeartbeats = devices;

        badge.textContent = devices.length;

        if (devices.length === 0) {
            list.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:32px 20px; color:var(--text-sub);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3; margin-bottom:10px; display:block; margin-inline:auto;"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    <p style="margin:0; font-size:0.85rem;">No devices discovered yet. Power on your ESP32 device and it will appear here automatically.</p>
                </div>`;
            return;
        }

        list.innerHTML = devices.map(d => renderDeviceCard(d)).join("");
        
        // Update plant cards to reflect new online statuses if they are already loaded
        if (globalPlants.length > 0 && globalDevices.length > 0) {
            renderPlants(globalPlants, globalDevices);
        }
    } catch (e) {
        list.innerHTML = `<div style="grid-column:1/-1; color:#ef4444; font-size:0.83rem; padding:12px;">Failed to load devices. Make sure you are logged in.</div>`;
    }
};

function formatSecondsAgo(sec) {
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
}

function renderDeviceCard(d) {
    const online = d.online;
    const dotColor = online ? "#22c55e" : "#ef4444";
    const dotShadow = online ? "#22c55e" : "#ef4444";
    const statusText = online ? "Online" : "Offline";
    const statusTextColor = online ? "#22c55e" : "#ef4444";
    const meterIdsText = d.meter_ids && d.meter_ids.length
        ? d.meter_ids.map(id => `<span style="display:inline-block; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); border-radius:4px; padding:1px 6px; font-size:0.72rem; font-family:monospace;">#${id}</span>`).join(" ")
        : `<span style="color:var(--text-sub); font-size:0.78rem;">No meters responding</span>`;

    const configuredBadge = d.is_configured
        ? `<span style="background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3); border-radius:20px; padding:2px 9px; font-size:0.72rem; font-weight:600;">✓ Configured</span>`
        : `<span style="background:rgba(234,179,8,0.15); color:#ca8a04; border:1px solid rgba(234,179,8,0.3); border-radius:20px; padding:2px 9px; font-size:0.72rem; font-weight:600;">⚠ Not Configured</span>`;

    const plantInfo = d.is_configured && d.plant
        ? `<div style="font-size:0.78rem; color:var(--text-sub); margin-top:4px;">Plant: <strong style="color:var(--text-main);">${d.plant || ''}</strong></div>`
        : "";

    const actionBtn = d.is_configured
        ? `<button onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, true)"
               style="background:transparent; border:1px solid var(--border-color); color:var(--text-sub); padding:5px 12px; border-radius:7px; font-size:0.78rem; cursor:pointer; white-space:nowrap;">
               Edit
           </button>
           <button onclick="unregisterDevice('${d.device_id}')"
               style="background:transparent; border:1px solid rgba(239,68,68,0.4); color:#f87171; padding:5px 12px; border-radius:7px; font-size:0.78rem; cursor:pointer; white-space:nowrap;">
               Unlink
           </button>`
        : `<button onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, false)"
               style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; padding:6px 14px; border-radius:7px; font-size:0.78rem; cursor:pointer; font-weight:600; white-space:nowrap;">
               Configure →
           </button>`;

    return `
    <div style="
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: 14px;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.2s;
        ${online ? 'border-left: 3px solid ' + dotColor + ';' : 'border-left: 3px solid #374151;'}
    ">
        <!-- Top row: ID + status -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="width:8px; height:8px; border-radius:50%; background:${dotColor}; box-shadow:0 0 6px ${dotShadow}; flex-shrink:0;"></div>
                <span style="font-family:'Share Tech Mono',monospace; font-size:1rem; font-weight:700; color:var(--text-main);">${d.device_id}</span>
                ${configuredBadge}
            </div>
            <span style="font-size:0.75rem; color:${statusTextColor}; font-weight:600;">${statusText}</span>
        </div>

        <!-- Meta info -->
        <div style="font-size:0.78rem; color:var(--text-sub); display:flex; flex-direction:column; gap:3px;">
            <div>IP: <code style="font-size:0.78rem;">${d.ip_addr || '—'}</code> &nbsp;|&nbsp; Last seen: ${formatSecondsAgo(d.seconds_ago)}</div>
            <div>Meters responding: ${d.meter_count}</div>
            ${plantInfo}
        </div>

        <!-- Meter IDs -->
        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
            ${meterIdsText}
        </div>

        <!-- Action buttons -->
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px; flex-wrap:wrap;">
            ${actionBtn}
        </div>
    </div>`;
}

// ── Register Device Modal ──────────────────────────────────────────────────────

window.openRegisterDeviceModal = async function(deviceId, ipAddr, meterCount, isEdit) {
    document.getElementById("regDeviceId").value = deviceId;
    document.getElementById("regDeviceLabel").value = "";
    document.getElementById("regDeviceError").style.display = "none";

    // Preview
    document.getElementById("registerDevicePreview").innerHTML = `
        <div><strong style="color:var(--text-main);">Device ID:</strong> ${deviceId}</div>
        <div><strong style="color:var(--text-main);">IP Address:</strong> ${ipAddr || '—'}</div>
        <div><strong style="color:var(--text-main);">Active Meters:</strong> ${meterCount}</div>
    `;

    // Populate plant select
    const sel = document.getElementById("regPlantSelect");
    sel.innerHTML = '<option value="" disabled selected>Select a Plant…</option>';
    globalPlants.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
    });

    // If editing, pre-select current plant
    if (isEdit) {
        try {
            const cfgRes = await fetch("/api/device_configs");
            const cfgData = await cfgRes.json();
            const existing = cfgData.find(c => c.device_id === deviceId);
            if (existing) {
                sel.value = existing.plant;
                document.getElementById("regDeviceLabel").value = existing.label || "";
            }
        } catch (_) {}
    }

    document.getElementById("registerDeviceModal").style.display = "flex";
};

window.closeRegisterDeviceModal = function() {
    document.getElementById("registerDeviceModal").style.display = "none";
};

document.getElementById("registerDeviceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("regDeviceError");
    errEl.style.display = "none";

    const payload = {
        device_id: document.getElementById("regDeviceId").value,
        plant:     document.getElementById("regPlantSelect").value,
        label:     document.getElementById("regDeviceLabel").value.trim(),
    };

    try {
        const res = await fetch("/api/device_configs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Save failed");
        closeRegisterDeviceModal();
        loadDiscoveredDevices();
        loadAllDevices();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = "block";
    }
});

window.unregisterDevice = async function(deviceId) {
    if (!confirm(`Unlink device "${deviceId}" from its plant?\n\nHistorical data is NOT deleted. The device will show as unconfigured until re-registered.`)) return;
    try {
        const res = await fetch(`/api/device_configs/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Unlink failed");
        loadDiscoveredDevices();
    } catch (err) {
        alert("Failed to unlink device: " + err.message);
    }
};



// ================= DATA FETCHING & RENDERING =================

function loadAllDevices() {
    Promise.all([
        fetch('/plants').then(res => res.json()),
        fetch('/api/meter_config').then(res => res.json())
    ])
    .then(([plants, devices]) => {
        globalDevices = devices;
        renderPlants(plants, devices);
    })
    .catch(err => {
        console.error("Error fetching data:", err);
        plantsContainer.innerHTML = `<div style="color: #ef4444;">Failed to load data. Please try again.</div>`;
    });
}

function renderPlants(plants, devices) {
    globalPlants = plants;
    
    // Group devices by plant
    globalGroupedDevices = {};
    plants.forEach(p => globalGroupedDevices[p] = []);
    
    devices.forEach(dev => {
        if (!globalGroupedDevices[dev.plant]) {
            globalGroupedDevices[dev.plant] = [];
            if (!plants.includes(dev.plant)) plants.push(dev.plant);
        }
        globalGroupedDevices[dev.plant].push(dev);
    });

    plantsGridView.innerHTML = "";

    if (document.getElementById("plantCountBadge")) {
        document.getElementById("plantCountBadge").textContent = plants.length;
    }

    if (plants.length === 0) {
        plantsGridView.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-sub);">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.2; margin-bottom:16px; display:block; margin-inline:auto;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            No plants configured yet. Create one to get started!
        </div>`;
        return;
    }

    plants.forEach(plant => {
        const plantDevices = globalGroupedDevices[plant] || [];
        
        let devicesHtml = "";
        if (plantDevices.length === 0) {
            devicesHtml = `<tr><td colspan="4" style="text-align:center; color:var(--text-sub); padding:40px 20px;">No devices added to this plant yet.</td></tr>`;
        } else {
            devicesHtml = plantDevices.map(dev => {
                const badgeClass = dev.type === "incomer" ? "badge-incomer" : "badge-submeter";
                const badgeLabel = dev.type === "incomer" ? "Main Incomer" : "Submeter";
                
                // Determine if this meter is online based on heartbeats
                // 1. Find if any heartbeat is mapped to this plant
                // 2. Check if this meter's ID is in the responding meter_ids list
                const hb = (window.globalHeartbeats || []).find(h => h.plant === dev.plant && h.online);
                const isOnline = hb && hb.meter_ids && hb.meter_ids.includes(String(dev.meter_id));
                const statusDot = isOnline ? '<div style="width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 6px #22c55e; display:inline-block; margin-right:6px;" title="Online"></div>' : '<div style="width:8px; height:8px; border-radius:50%; background:#ef4444; display:inline-block; margin-right:6px;" title="Offline"></div>';

                return `
                <tr class="admin-table-row">
                    <td style="font-weight:600; font-family:'Share Tech Mono',monospace; font-size:0.85rem;">#${dev.meter_id}</td>
                    <td style="font-weight:500;">${statusDot} ${dev.name}</td>
                    <td><span class="badge-type ${badgeClass}">${badgeLabel}</span></td>
                    <td style="text-align:right;">
                        <div class="actions-dropdown" style="display:inline-block; text-align:left;">
                            <button class="action-btn" style="padding:4px 8px; border:none; background:transparent; color:var(--text-main); cursor:pointer;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                            </button>
                            <div class="dropdown-content" style="min-width:140px; right:0; top:100%; z-index:999;">
                                <button class="dropdown-item" onclick='editDevice(${JSON.stringify(dev)})'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    Edit Meter
                                </button>
                                <button class="dropdown-item" onclick='deleteDevice(${dev.id})' style="color:#f87171;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>`;
            }).join("");
        }

        const card = document.createElement("div");
        card.className = "plant-card-industrial";
        card.style.overflow = "visible";
        card.innerHTML = `
            <div class="plant-card-header">
                <div>
                    <h2 class="plant-card-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg>
                        <span class="plant-card-name-text">${plant}</span>
                    </h2>
                    <p class="plant-card-subtitle">${plantDevices.length} device${plantDevices.length !== 1 ? 's' : ''} configured</p>
                </div>
                <div class="actions-dropdown">
                    <button class="submit-btn" style="padding: 6px 12px; font-size:0.75rem;">
                        Options
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div class="dropdown-content">
                        <button class="dropdown-item" onclick="window.openDeviceModal('${plant}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add Device
                        </button>
                        <button class="dropdown-item" onclick="window.deletePlant('${plant}')" style="color:#f87171;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            Delete Plant
                        </button>
                    </div>
                </div>
            </div>
            <div class="plant-table-container">
                <table style="width:100%; border-collapse:collapse; text-align:left;">
                    <thead>
                        <tr class="admin-table-header">
                            <th>Meter ID</th>
                            <th>Meter Name</th>
                            <th>Type</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${devicesHtml}
                    </tbody>
                </table>
            </div>
        `;
        plantsGridView.appendChild(card);
    });
}

window.filterPlants = function() {
    const input = document.getElementById("plantSearchInput").value.toLowerCase();
    const cards = plantsGridView.querySelectorAll(".plant-card-industrial");
    cards.forEach(card => {
        const textSpan = card.querySelector(".plant-card-name-text");
        if (textSpan) {
            const text = textSpan.textContent.toLowerCase();
            if (text.includes(input)) {
                card.style.display = "flex";
            } else {
                card.style.display = "none";
            }
        }
    });
};

window.openDeviceModal = function(plantName = "") {
    deviceModalTitle.innerText = "Add New Device";
    deviceForm.reset();
    
    populatePlantSelect(plantName);
    const devPlantSelect = document.getElementById("devPlant");

    if (plantName) {
        devPlantSelect.style.opacity = "0.7";
        devPlantSelect.style.pointerEvents = "none";
    } else {
        devPlantSelect.style.opacity = "1";
        devPlantSelect.style.pointerEvents = "auto";
    }
    
    currentConfigId = null;
    devError.style.display = "none";
    deviceManagerModal.style.display = "flex";
};

window.closeDeviceModal = function closeDeviceModal() {
    deviceManagerModal.style.display = "none";
}

// ================= PLANT CREATION LOGIC =================

const plantModal = document.getElementById("plantModal");
const plantForm = document.getElementById("plantForm");
const newPlantName = document.getElementById("newPlantName");
const plantError = document.getElementById("plantError");

window.openPlantModal = function() {
    plantForm.reset();
    plantError.style.display = "none";
    plantModal.style.display = "flex";
};

window.closePlantModal = function() {
    plantModal.style.display = "none";
};

plantForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = newPlantName.value.trim();
    if (!name) return;

    fetch("/api/plants", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            closePlantModal();
            loadAllDevices();
        } else {
            plantError.innerText = data.error || "Failed to create plant.";
            plantError.style.display = "block";
        }
    })
    .catch(err => {
        console.error("Error creating plant:", err);
        plantError.innerText = "Network error. Please try again.";
        plantError.style.display = "block";
    });
});

window.editDevice = function(dev) {
    deviceModalTitle.innerText = "Edit Device";
    populatePlantSelect(dev.plant);
    document.getElementById("devPlant").readOnly = false;
    document.getElementById("devPlant").style.opacity = "1";
    document.getElementById("devMeterId").value = dev.meter_id;
    document.getElementById("devName").value = dev.name;
    document.getElementById("devType").value = dev.type;
    currentConfigId = dev.id;
    devError.style.display = "none";
    deviceManagerModal.style.display = "flex";
};

window.deleteDevice = function(id) {
    if(confirm("Are you sure you want to delete this device configuration?")) {
        fetch(`/api/meter_config/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                loadAllDevices();
            })
            .catch(err => alert("Failed to delete device."));
    }
};

window.deletePlant = function(plantName) {
    // Step 1: confirm deletion
    if (!confirm(`Delete plant "${plantName}"?\n\nThis will remove the plant and ALL its meter configs from the dashboard.`)) return;

    // Step 2: ask if sensor data (meter_data) should also be wiped
    const deleteData = confirm(
        `Do you also want to DELETE all recorded sensor data (kWh readings, history) for "${plantName}"?\n\nClick OK to delete data too.\nClick Cancel to keep the historical data.`
    );

    const url = `/api/plants/${encodeURIComponent(plantName)}?delete_data=${deleteData}`;

    fetch(url, { method: 'DELETE' })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            return data;
        })
        .then(() => {
            loadAllDevices();
        })
        .catch(err => alert('Failed to delete plant: ' + err.message));
};

deviceForm.addEventListener("submit", (e) => {
    e.preventDefault();
    devError.style.display = "none";
    
    const payload = {
        plant: document.getElementById("devPlant").value,
        meter_id: document.getElementById("devMeterId").value,
        name: document.getElementById("devName").value,
        type: document.getElementById("devType").value
    };
    
    // In our backend, saving handles both insert and update based on plant+meter_id.
    // However, if we edit and change meter_id, it might create a new one instead of updating.
    // The current API in app.py uses plant+meter_id as unique keys.
    fetch('/api/meter_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || "Save failed");
        return data;
    })
    .then(data => {
        closeDeviceModal();
        loadAllDevices();
    })
    .catch(err => {
        devError.textContent = err.message;
        devError.style.display = "block";
    });
});


// ================= IMPORT CONFIG =================
window.handleImportConfig = function(input) {
    const file = input.files[0];
    if (!file) return;

    const resultBanner = document.getElementById("importResult");
    resultBanner.style.display = "none";

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const jsonPayload = JSON.parse(e.target.result);
            
            fetch("/api/import_config", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(jsonPayload)
            })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.detail || "Import failed");
                return data;
            })
            .then(data => {
                resultBanner.style.background = "linear-gradient(135deg, rgba(22,163,74,0.15), rgba(21,128,61,0.1))";
                resultBanner.style.border = "1px solid rgba(22,163,74,0.4)";
                resultBanner.style.color = "#16a34a";
                resultBanner.innerHTML = `
                    ✅ <strong>Config Imported Successfully!</strong>
                    &nbsp;|&nbsp; ${data.meters_upserted} meter(s) updated
                    &nbsp;|&nbsp; ${data.plants_added} new plant(s) added
                    &nbsp;— <em>Your existing meter data is safe.</em>
                `;
                resultBanner.style.display = "block";
                loadAllDevices(); // Refresh the table
            })
            .catch(err => {
                resultBanner.style.background = "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(220,38,38,0.1))";
                resultBanner.style.border = "1px solid rgba(239,68,68,0.4)";
                resultBanner.style.color = "#ef4444";
                resultBanner.innerHTML = `❌ <strong>Import Failed:</strong> ${err.message}`;
                resultBanner.style.display = "block";
            });
        } catch (err) {
            resultBanner.style.background = "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(220,38,38,0.1))";
            resultBanner.style.border = "1px solid rgba(239,68,68,0.4)";
            resultBanner.style.color = "#ef4444";
            resultBanner.innerHTML = `❌ <strong>Import Failed:</strong> Invalid JSON file formatting.`;
            resultBanner.style.display = "block";
        }
    };
    
    reader.readAsText(file);
    
    // Reset file input so same file can be re-selected if needed
    input.value = "";
}

function populatePlantSelect(selectedValue = "") {
    const devPlantSelect = document.getElementById("devPlant");
    devPlantSelect.innerHTML = '<option value="" disabled selected>Select a Plant...</option>';
    
    globalPlants.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        devPlantSelect.appendChild(opt);
    });
    
    if (selectedValue && globalPlants.includes(selectedValue)) {
        devPlantSelect.value = selectedValue;
    }
};
