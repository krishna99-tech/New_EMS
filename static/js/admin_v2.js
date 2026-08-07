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
    loadMeterGroups();
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
    if (!list) return; // Prevent execution on pages without this element
    try {
        const res = await fetch("/api/device_heartbeats");
        if (!res.ok) throw new Error("Not logged in");
        const devices = await res.json();
        window.globalHeartbeats = devices;

        if (badge) badge.textContent = devices.length;

        if (devices.length === 0) {
            list.innerHTML = `<div class="admin-empty-state">No devices discovered yet. Power on your ESP32 device and it will appear here.</div>`;
            updateAdminStats(globalPlants, globalDevices, devices);
            return;
        }

        list.innerHTML = devices.map(d => renderDeviceCard(d)).join("");
        
        if (globalPlants.length > 0 && globalDevices.length > 0) {
            renderPlants(globalPlants, globalDevices);
        } else {
            updateAdminStats(globalPlants, globalDevices, devices);
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
    const statusText = online ? "Online" : "Offline";
    const meterIdsText = d.meter_ids && d.meter_ids.length
        ? d.meter_ids.map(id => `<span class="admin-badge">#${id}</span>`).join(" ")
        : `<span class="text-muted">No meters responding</span>`;

    const configuredBadge = d.is_configured
        ? `<span class="badge-configured">Configured</span>`
        : `<span class="badge-unconfigured">Not Configured</span>`;

    const plantInfo = d.is_configured && d.plant
        ? `<div>Plant: <strong>${d.plant || ""}</strong></div>`
        : "";

    const actionBtn = d.is_configured
        ? `<button type="button" class="btn-ghost" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, true)">Edit</button>
           <button type="button" class="btn-ghost danger" onclick="unregisterDevice('${d.device_id}')">Unlink</button>`
        : `<button type="button" class="submit-btn" style="padding:6px 14px; font-size:0.78rem;" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, false)">Configure</button>`;

    return `
    <div class="device-card ${online ? "online" : "offline"}">
        <div class="device-card-top">
            <div class="device-card-id">
                <span class="status-dot ${online ? "online" : "offline"}"></span>
                ${d.device_id}
                ${configuredBadge}
            </div>
            <span style="font-size:0.75rem; font-weight:600; color:${online ? "#22c55e" : "#ef4444"};">${statusText}</span>
        </div>
        <div class="device-card-meta">
            <div>IP: <code>${d.ip_addr || "—"}</code> · Last seen: ${formatSecondsAgo(d.seconds_ago)}</div>
            <div>Meters responding: ${d.meter_count}</div>
            ${plantInfo}
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">${meterIdsText}</div>
        <div class="device-card-actions">${actionBtn}</div>
    </div>`;
}

function updateAdminStats(plants, devices, heartbeats) {
    const elPlants = document.getElementById("statPlants");
    const elMeters = document.getElementById("statMeters");
    const elDevices = document.getElementById("statDevices");
    const elOnline = document.getElementById("statOnline");
    if (!elPlants) return;
    elPlants.textContent = plants?.length ?? 0;
    elMeters.textContent = devices?.length ?? 0;
    elDevices.textContent = heartbeats?.length ?? 0;
    elOnline.textContent = (heartbeats || []).filter(h => h.online).length;
}

function updateGroupStats() {
    const elGroups = document.getElementById("statGroupCount");
    const elMembers = document.getElementById("statMemberCount");
    if (!elGroups) return;
    elGroups.textContent = globalMeterGroups.length;
    elMembers.textContent = globalMeterGroups.reduce((s, g) => s + (g.members?.length || 0), 0);
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

document.getElementById("registerDeviceForm")?.addEventListener("submit", async (e) => {
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
        if (window.loadDiscoveredDevices) loadDiscoveredDevices();
        if (window.loadAllDevices) loadAllDevices();
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
        if (window.loadDiscoveredDevices) loadDiscoveredDevices();
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
        globalPlants = plants;
        renderPlants(plants, devices);
        updateAdminStats(plants, devices, window.globalHeartbeats || []);
    })
    .catch(err => {
        console.error("Error fetching data:", err);
        if (plantsGridView) {
            plantsGridView.innerHTML = `<div class="admin-empty-state" style="color:#ef4444;">Failed to load data. Please try again.</div>`;
        }
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

    if (!plantsGridView) return; // Prevent execution on pages without this element
    plantsGridView.innerHTML = "";

    if (document.getElementById("plantCountBadge")) {
        document.getElementById("plantCountBadge").textContent = plants.length;
    }

    if (plants.length === 0) {
        plantsGridView.innerHTML = `<div class="admin-empty-state">No plants configured yet. Create one to get started.</div>`;
        updateAdminStats(plants, devices, window.globalHeartbeats || []);
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
                <div class="actions-dropdown" onclick="this.classList.toggle('active')">
                    <button class="action-btn" type="button" style="padding: 6px 12px; font-size:0.75rem;">
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
    updateAdminStats(plants, devices, window.globalHeartbeats || []);
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

plantForm?.addEventListener("submit", (e) => {
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

deviceForm?.addEventListener("submit", (e) => {
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

// ================= CUSTOM METER GROUPS =================

let globalMeterGroups = [];

async function loadMeterGroups() {
    try {
        const res = await fetch("/api/meter_groups");
        if (res.ok) {
            globalMeterGroups = await res.json();
            updateGroupFilterSelect();
            renderMeterGroups();
            renderGroupPresets();
        }
    } catch (e) {
        console.error("Failed to load meter groups", e);
    }
}

async function renderGroupPresets() {
    const container = document.getElementById("groupPresetsList");
    if (!container) return;
    try {
        const res = await fetch("/api/meter_groups/presets");
        if (!res.ok) throw new Error("Failed");
        const presets = await res.json();
        if (!presets.length) {
            container.innerHTML = `<div class="admin-empty-state">Configure meters first to use presets.</div>`;
            return;
        }
        window._availablePresets = presets;
        
        const optionsHtml = presets.map((p, i) => `
            <option value="${i}">${p.label}</option>
        `).join("");

        container.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: center; max-width: 500px;">
                <select id="presetSelect" class="form-control" style="flex: 1;">
                    ${optionsHtml}
                </select>
                <button type="button" class="submit-btn" style="padding: 10px 18px;" onclick="executeSelectedPreset()">
                    Create / Update
                </button>
            </div>
        `;
    } catch {
        container.innerHTML = `<div class="admin-empty-state">Could not load presets.</div>`;
    }
}
window.executeSelectedPreset = function() {
    const sel = document.getElementById("presetSelect");
    if (!sel || !window._availablePresets) return;
    const p = window._availablePresets[sel.value];
    if (p) {
        createGroupPreset(p.id, p.plant);
    }
};

window.createGroupPreset = async function(presetId, plant) {
    try {
        const res = await fetch("/api/meter_groups/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preset_id: presetId, plant }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed");
        alert(`Group "${data.name}" ready — ${data.members_added} meter(s) added, ${data.members_skipped} skipped (${data.total_members} total).`);
        loadMeterGroups();
    } catch (e) {
        alert(e.message || "Failed to create preset group");
    }
};

function updateGroupFilterSelect() {
    const sel = document.getElementById("groupFilterSelect");
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="all">All Groups</option>';
    globalMeterGroups.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        sel.appendChild(opt);
    });
    if (globalMeterGroups.some(g => g.id.toString() === currentVal)) {
        sel.value = currentVal;
    }
}

window.filterMeterGroups = function() {
    renderMeterGroups();
};

function renderMeterGroups() {
    const list = document.getElementById("meterGroupsList");
    if (!list) return;
    
    if (globalMeterGroups.length === 0) {
        list.innerHTML = `<div class="admin-empty-state">No custom groups created yet.</div>`;
        updateGroupStats();
        return;
    }
    
    const filterVal = document.getElementById("groupFilterSelect")?.value || "all";
    
    let html = "";
    globalMeterGroups.forEach(g => {
        if (filterVal !== "all" && g.id.toString() !== filterVal) return;
        
        let membersHtml = g.members.length === 0 ? 
            `<div style="font-size:0.85rem; color:var(--text-sub); padding:16px; text-align:center; background:rgba(0,0,0,0.02); border-radius:8px;">No meters added yet</div>` :
            `<div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
                ${g.members.map(m => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-base); border:1px solid var(--border-color); border-radius:8px; transition:border-color 0.2s;">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span style="font-size:0.85rem; font-weight:600; color:var(--text-main);">${m.plant}</span>
                            <span style="font-size:0.75rem; color:var(--text-sub);">${m.meter_name} (ID: <span style="font-family:monospace;">${m.meter_id}</span>)</span>
                        </div>
                        <button onclick="removeGroupMember(${g.id}, ${m.id})" class="action-btn" style="color:#ef4444; border:1px solid rgba(239,68,68,0.2); background:rgba(239,68,68,0.05); padding:6px; border-radius:6px; cursor:pointer;" title="Remove meter">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `).join("")}
            </div>`;
            
        let plantOptions = '<option value="" disabled selected>Select a Plant...</option>';
        globalPlants.forEach(p => { plantOptions += `<option value="${p}">${p}</option>`; });

        let addFormHtml = `
            <div id="inlineAddForm_${g.id}" style="display:none; margin-top: 16px; padding: 16px; background: var(--bg-base); border-radius: 8px; border: 1px solid var(--border-color);">
                <h4 style="margin-top:0; margin-bottom: 12px; font-size: 0.9rem;">Add Meter to Group</h4>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <select id="inlinePlant_${g.id}" class="form-control" style="flex:1; min-width: 120px;" onchange="populateInlineMeterSelect(${g.id})">
                        ${plantOptions}
                    </select>
                    <select id="inlineMeter_${g.id}" class="form-control" style="flex:1; min-width: 120px;">
                        <option value="" disabled selected>Select Plant first...</option>
                    </select>
                    <button type="button" class="submit-btn" style="padding: 8px 16px;" onclick="submitInlineAddMember(${g.id})">Add</button>
                    <button type="button" class="action-btn" style="padding: 8px 16px; border: 1px solid var(--border-color);" onclick="document.getElementById('inlineAddForm_${g.id}').style.display='none'">Cancel</button>
                </div>
                <p id="inlineError_${g.id}" class="form-error" style="display:none; margin-top:8px; margin-bottom:0;"></p>
            </div>
        `;
            
        html += `
            <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:20px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:16px; transition:transform 0.2s, box-shadow 0.2s;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="background:var(--accent-primary); color:white; width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 6px rgba(79, 70, 229, 0.2);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        </div>
                        <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--text-main); letter-spacing:-0.01em;">${g.name}</h3>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button onclick="document.getElementById('inlineAddForm_${g.id}').style.display='block'" class="action-btn" style="background:var(--bg-base); border:1px solid var(--border-color); color:var(--text-main); padding:6px 12px; border-radius:6px; cursor:pointer;" title="Add Meter">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            Add
                        </button>
                        <button onclick="deleteGroup(${g.id})" class="action-btn" style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); color:#ef4444; padding:6px 12px; border-radius:6px; cursor:pointer;" title="Delete Group">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
                ${addFormHtml}
                <details style="border-top: 1px solid var(--border-color); padding-top: 12px;">
                    <summary style="cursor: pointer; font-weight: 600; color: var(--text-sub); display: flex; align-items: center; gap: 8px; user-select: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        ${g.members.length} Meters Configured
                    </summary>
                    ${membersHtml}
                </details>
            </div>
        `;
    });
    
    list.innerHTML = html;
    updateGroupStats();
}

window.openCreateGroupModal = function() {
    document.getElementById("createGroupModal").style.display = "flex";
    document.getElementById("newGroupName").value = "";
    document.getElementById("groupError").style.display = "none";
};

window.closeCreateGroupModal = function() {
    document.getElementById("createGroupModal").style.display = "none";
};

document.getElementById("createGroupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newGroupName").value;
    const err = document.getElementById("groupError");
    
    try {
        const res = await fetch("/api/meter_groups", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            closeCreateGroupModal();
            loadMeterGroups();
        } else {
            const data = await res.json();
            err.textContent = data.detail || "Failed to create group";
            err.style.display = "block";
        }
    } catch (error) {
        err.textContent = "Network error";
        err.style.display = "block";
    }
});

window.deleteGroup = async function(id) {
    if (!confirm("Are you sure you want to delete this group?")) return;
    try {
        const res = await fetch(`/api/meter_groups/${id}`, { method: "DELETE" });
        if (res.ok) {
            loadMeterGroups();
        } else {
            alert("Failed to delete group");
        }
    } catch (e) {
        alert("Network error");
    }
}

window.populateInlineMeterSelect = function(groupId) {
    const plant = document.getElementById(`inlinePlant_${groupId}`).value;
    const meterSelect = document.getElementById(`inlineMeter_${groupId}`);
    
    meterSelect.innerHTML = '<option value="" disabled selected>Select a Meter...</option>';
    
    globalDevices.filter(d => d.plant === plant).forEach(d => {
        meterSelect.innerHTML += `<option value="${d.meter_id}">${d.name} (ID: ${d.meter_id})</option>`;
    });
};

window.submitInlineAddMember = async function(groupId) {
    const plantSelect = document.getElementById(`inlinePlant_${groupId}`);
    const meterSelect = document.getElementById(`inlineMeter_${groupId}`);
    const err = document.getElementById(`inlineError_${groupId}`);
    
    const plant = plantSelect.value;
    const meter_id = meterSelect.value;
    
    if (!plant || !meter_id) {
        err.textContent = "Please select both a plant and a meter.";
        err.style.display = "block";
        return;
    }
    
    try {
        const res = await fetch(`/api/meter_groups/${groupId}/members`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ plant, meter_id })
        });
        if (res.ok) {
            document.getElementById(`inlineAddForm_${groupId}`).style.display = "none";
            loadMeterGroups();
        } else {
            const data = await res.json();
            err.textContent = data.detail || "Failed to add member";
            err.style.display = "block";
        }
    } catch (error) {
        err.textContent = "Network error";
        err.style.display = "block";
    }
};

window.removeGroupMember = async function(groupId, memberId) {
    if (!confirm("Remove this meter from the group?")) return;
    try {
        const res = await fetch(`/api/meter_groups/${groupId}/members/${memberId}`, { method: "DELETE" });
        if (res.ok) {
            loadMeterGroups();
        } else {
            alert("Failed to remove member");
        }
    } catch (e) {
        alert("Network error");
    }
};
