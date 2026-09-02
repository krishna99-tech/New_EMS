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
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Server Error (${res.status}): ${errorText}`);
        }
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
        console.error("fetchDevices error:", e);
        list.innerHTML = `<div style="grid-column:1/-1; color:#ef4444; font-size:0.83rem; padding:12px;">Failed to load devices: ${e.message}</div>`;
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
    const statusColor = online ? "var(--dj-success)" : "var(--dj-danger)";
    const meterIdsText = d.meter_ids && d.meter_ids.length
        ? d.meter_ids.map(id => `<span style="background:var(--dj-bg-sub); border:1px solid var(--dj-border); padding:2px 6px; border-radius:3px; font-size:0.75rem; font-family:monospace;">#${id}</span>`).join(" ")
        : `<span style="color:var(--dj-text-sub); font-size:0.8rem;">No meters responding</span>`;

    const configuredBadge = d.is_configured
        ? `<span style="background:var(--dj-success); color:white; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">Configured</span>`
        : `<span style="background:#999; color:white; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">Unconfigured</span>`;

    const plantInfo = d.is_configured && d.plant
        ? `<tr><td style="padding:4px 0; color:var(--dj-text-sub);">Plant</td><td style="padding:4px 0; text-align:right; font-weight:bold;">${d.plant || "—"}</td></tr>`
        : "";

    const actionBtn = d.is_configured
        ? `<button type="button" class="action-btn edit-btn" style="padding:4px 12px; font-size:0.75rem;" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, true)">Edit</button>
           <button type="button" class="action-btn delete-btn" style="padding:4px 12px; font-size:0.75rem;" onclick="unregisterDevice('${d.device_id}')">Unlink</button>`
        : `<button type="button" class="submit-btn" style="padding:5px 12px; font-size:0.75rem;" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, false)">Configure</button>`;

    return `
    <div style="border: 1px solid var(--dj-border); border-radius: 4px; background: var(--dj-bg); color: var(--dj-text); overflow: hidden; display: flex; flex-direction: column;">
        <div style="background: var(--dj-header-bg-sub); color: var(--dj-header-text); padding: 8px 12px; font-size: 13px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>${d.device_id}</span>
            ${configuredBadge}
        </div>
        <div style="padding: 12px; flex: 1; display: flex; flex-direction: column; gap: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <tr>
                    <td style="padding:4px 0; color:var(--dj-text-sub);">Status</td>
                    <td style="padding:4px 0; text-align:right; font-weight:bold; color:${statusColor};">${statusText}</td>
                </tr>
                <tr>
                    <td style="padding:4px 0; color:var(--dj-text-sub);">IP Address</td>
                    <td style="padding:4px 0; text-align:right; font-family:monospace;">${d.ip_addr || "—"}</td>
                </tr>
                <tr>
                    <td style="padding:4px 0; color:var(--dj-text-sub);">Last Seen</td>
                    <td style="padding:4px 0; text-align:right;">${formatSecondsAgo(d.seconds_ago)}</td>
                </tr>
                ${plantInfo}
            </table>
            
            <div style="margin-top: 4px;">
                <div style="font-size:0.75rem; color:var(--dj-text-sub); margin-bottom:4px;">Meters Responding (${d.meter_count}):</div>
                <div style="display:flex; flex-wrap:wrap; gap:4px;">${meterIdsText}</div>
            </div>
        </div>
        <div style="padding: 8px 12px; background: var(--dj-bg-sub); border-top: 1px solid var(--dj-border); display: flex; justify-content: flex-end; gap: 8px;">
            ${actionBtn}
        </div>
    </div>`;
}

function updateAdminStats(plants, devices, heartbeats) {
    const elPlants = document.getElementById("statPlants");
    const elMeters = document.getElementById("statMeters");
    const elDevices = document.getElementById("statDevices");
    const elOnline = document.getElementById("statOnline");
    if (!elPlants) return;
    if (elPlants) elPlants.textContent = plants?.length ?? 0;
    if (elMeters) elMeters.textContent = devices?.length ?? 0;
    if (elDevices) elDevices.textContent = heartbeats?.length ?? 0;
    if (elOnline) elOnline.textContent = (heartbeats || []).filter(h => h.online).length;
}

function updateGroupStats() {
    const elGroups = document.getElementById("statGroupCount");
    const elMembers = document.getElementById("statMemberCount");
    if (elGroups) elGroups.textContent = globalMeterGroups.length;
    if (elMembers) elMembers.textContent = globalMeterGroups.reduce((s, g) => s + (g.members?.length || 0), 0);
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

window.showCustomConfirmModal = function({
    title = "Confirm Deletion",
    icon = "⚠️",
    message = "Are you sure you want to proceed?",
    submessage = "This action cannot be undone.",
    showDataCheckbox = false,
    checkboxLabel = "Also permanently delete all recorded sensor data (kWh readings & history)",
    confirmText = "Delete Permanently",
    onConfirm = null
}) {
    const modal = document.getElementById("customConfirmModal");
    if (!modal) {
        console.error("customConfirmModal element not found in DOM.");
        return;
    }

    const titleEl = document.getElementById("confirmModalTitle");
    const iconEl = document.getElementById("confirmModalIcon");
    const msgEl = document.getElementById("confirmModalMessage");
    const submsgEl = document.getElementById("confirmModalSubmessage");

    if (titleEl) titleEl.textContent = title;
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;
    if (submsgEl) submsgEl.textContent = submessage;
    
    const checkContainer = document.getElementById("confirmDataCheckContainer");
    const checkbox = document.getElementById("confirmDeleteDataCheckbox");
    const checkLabel = document.getElementById("confirmCheckboxLabel");

    if (showDataCheckbox && checkContainer) {
        checkContainer.style.display = "block";
        if (checkbox) checkbox.checked = false;
        if (checkLabel) checkLabel.textContent = checkboxLabel;
    } else if (checkContainer) {
        checkContainer.style.display = "none";
        if (checkbox) checkbox.checked = false;
    }

    const actionBtn = document.getElementById("confirmActionBtn");
    if (actionBtn) {
        actionBtn.textContent = confirmText;
        actionBtn.disabled = false;
        actionBtn.classList.remove("btn-loading");

        const newBtn = actionBtn.cloneNode(true);
        actionBtn.parentNode.replaceChild(newBtn, actionBtn);

        newBtn.addEventListener("click", async () => {
            const deleteData = checkbox ? checkbox.checked : false;
            newBtn.disabled = true;
            newBtn.classList.add("btn-loading");
            newBtn.textContent = "Processing...";
            try {
                if (onConfirm) await onConfirm({ deleteData });
                closeCustomConfirmModal();
            } catch (err) {
                newBtn.disabled = false;
                newBtn.classList.remove("btn-loading");
                newBtn.textContent = confirmText;
            }
        });
    }

    modal.style.display = "flex";
};

window.closeCustomConfirmModal = function() {
    const modal = document.getElementById("customConfirmModal");
    if (modal) modal.style.display = "none";
};

window.unregisterDevice = async function(deviceId) {
    showCustomConfirmModal({
        title: "Unlink Device",
        icon: "🔌",
        message: `Unlink device "${deviceId}" from its plant?`,
        submessage: "Historical data is NOT deleted. The device will show as unconfigured until re-registered.",
        confirmText: "Unlink Device",
        onConfirm: async () => {
            const res = await fetch(`/api/device_configs/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Unlink failed");
            if (window.loadDiscoveredDevices) loadDiscoveredDevices();
        }
    });
};



// ================= DATA FETCHING & RENDERING =================

function loadAllDevices() {
    Promise.all([
        fetch('/api/plants').then(res => res.json()),
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

    if (!plantsGridView) return;
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

        let tableRows = "";
        if (plantDevices.length === 0) {
            tableRows = `<tr><td colspan="5" style="text-align:center; color:var(--text-sub); padding:24px;">No meters added yet.</td></tr>`;
        } else {
            tableRows = plantDevices.map(dev => {
                const hb = (window.globalHeartbeats || []).find(h => h.plant === dev.plant && h.online);
                const isOnline = hb && hb.meter_ids && hb.meter_ids.includes(String(dev.meter_id));
                const statusLabel = isOnline
                    ? `<span style="color:var(--dj-success); font-weight:600; font-size:0.8rem;">● Online</span>`
                    : `<span style="color:var(--dj-danger); font-weight:600; font-size:0.8rem;">● Offline</span>`;
                const typeLabel = dev.type === "incomer" ? "Incomer" : "Submeter";

                return `
                <tr class="admin-table-row">
                    <td style="width:90px;">${statusLabel}</td>
                    <td style="width:60px; font-family:monospace; font-weight:600;">#${dev.meter_id}</td>
                    <td>${dev.name || '—'}</td>
                    <td style="width:90px;">${typeLabel}</td>
                    <td style="width:120px; text-align:right;">
                        <button class="action-btn edit-btn" style="padding:4px 10px; font-size:0.75rem;" onclick='editDevice(${JSON.stringify(dev)})'>Edit</button>
                        <button class="action-btn delete-btn" style="padding:4px 10px; font-size:0.75rem;" onclick='deleteDevice(${dev.id})'>Del</button>
                    </td>
                </tr>`;
            }).join("");
        }

        const section = document.createElement("div");
        section.className = "admin-panel";
        section.setAttribute("data-plant", plant);
        section.innerHTML = `
            <div class="admin-panel-header">
                <h3>
                    <span class="plant-card-name-text">${plant}</span>
                    <span class="admin-badge">${plantDevices.length}</span>
                </h3>
                <div style="display:flex; gap:8px; align-items:center;">
                    <a href="/?plant=${encodeURIComponent(plant)}" class="action-btn edit-btn" style="text-decoration:none; padding:5px 12px; font-size:0.78rem;">Dashboard →</a>
                    <button class="action-btn edit-btn" style="padding:5px 12px; font-size:0.78rem;" onclick="window.openDeviceModal('${plant}')">+ Add Meter</button>
                    <button class="action-btn delete-btn" style="padding:5px 12px; font-size:0.78rem;" onclick="window.deletePlant('${plant}')">Delete Plant</button>
                </div>
            </div>
            <div style="padding:0; overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr class="admin-table-header">
                            <th>Status</th>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Type</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;
        plantsGridView.appendChild(section);
    });
    updateAdminStats(plants, devices, window.globalHeartbeats || []);
}

window.filterPlants = function() {
    const input = document.getElementById("plantSearchInput").value.toLowerCase();
    const panels = plantsGridView.querySelectorAll(".admin-panel");
    panels.forEach(panel => {
        const textSpan = panel.querySelector(".plant-card-name-text");
        if (textSpan) {
            const text = textSpan.textContent.toLowerCase();
            panel.style.display = text.includes(input) ? "" : "none";
        }
    });
};

window.openDeviceModal = function(plantName = "") {
    deviceModalTitle.innerText = "Add New Device";
    deviceForm.reset();
    currentConfigId = null;
    
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
    showCustomConfirmModal({
        title: "Delete Submeter",
        icon: "🗑️",
        message: "Are you sure you want to delete this submeter configuration?",
        submessage: "This action will remove the meter from your plant monitoring list.",
        confirmText: "Delete Submeter",
        onConfirm: async () => {
            const res = await fetch(`/api/meter_config/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Failed to delete submeter.");
            if (window.loadAllDevices) loadAllDevices();
        }
    });
};

window.deletePlant = function(plantName) {
    showCustomConfirmModal({
        title: "Delete Plant",
        icon: "🏭",
        message: `Are you sure you want to delete plant "${plantName}"?`,
        submessage: "This will remove the plant and ALL its meter configurations from the dashboard.",
        showDataCheckbox: true,
        checkboxLabel: `Also permanently delete all recorded sensor readings (kWh history) for "${plantName}"`,
        confirmText: "Delete Plant",
        onConfirm: async ({ deleteData }) => {
            const url = `/api/plants/${encodeURIComponent(plantName)}?delete_data=${deleteData}`;
            const res = await fetch(url, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            if (window.loadAllDevices) loadAllDevices();
        }
    });
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
    if (currentConfigId) {
        payload.id = currentConfigId;
    }
    
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
        
        let tableRows = "";
        if (g.members.length === 0) {
            tableRows = `<tr><td colspan="4" style="text-align:center; color:var(--text-sub); padding:24px;">No meters assigned yet.</td></tr>`;
        } else {
            tableRows = g.members.map(m => `
                <tr class="admin-table-row">
                    <td>${m.plant}</td>
                    <td>${m.meter_name}</td>
                    <td style="font-family:monospace; font-weight:600;">#${m.meter_id}</td>
                    <td style="width:80px; text-align:right;">
                        <button onclick="removeGroupMember(${g.id}, ${m.id})" class="action-btn delete-btn" style="padding:4px 10px; font-size:0.75rem;">Remove</button>
                    </td>
                </tr>
            `).join("");
        }
            
        let plantOptions = '<option value="" disabled selected>Select a Plant...</option>';
        globalPlants.forEach(p => { plantOptions += `<option value="${p}">${p}</option>`; });

        let addFormHtml = `
            <div id="inlineAddForm_${g.id}" style="display:none; padding:16px 20px; border-top:1px solid var(--border-color); background:rgba(0,0,0,0.02);">
                <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
                    <div class="form-group" style="flex:1; min-width:140px;">
                        <label for="inlinePlant_${g.id}">Plant</label>
                        <select id="inlinePlant_${g.id}" onchange="populateInlineMeterSelect(${g.id})" style="padding:8px 10px; border:1px solid var(--border-color); border-radius:6px; background:var(--card-bg); color:var(--text-main); width:100%;">
                            ${plantOptions}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; min-width:140px;">
                        <label for="inlineMeter_${g.id}">Meter</label>
                        <select id="inlineMeter_${g.id}" style="padding:8px 10px; border:1px solid var(--border-color); border-radius:6px; background:var(--card-bg); color:var(--text-main); width:100%;">
                            <option value="" disabled selected>Select Plant first...</option>
                        </select>
                    </div>
                    <button type="button" class="submit-btn" style="padding:8px 16px; height:fit-content;" onclick="submitInlineAddMember(${g.id})">Add</button>
                    <button type="button" class="action-btn" style="padding:8px 12px; height:fit-content; border:1px solid var(--border-color);" onclick="document.getElementById('inlineAddForm_${g.id}').style.display='none'">Cancel</button>
                </div>
                <p id="inlineError_${g.id}" style="display:none; margin-top:8px; margin-bottom:0; color:#dc2626; font-size:0.85rem;"></p>
            </div>
        `;
            
        html += `
            <div class="admin-panel" style="margin-bottom:16px;">
                <div class="admin-panel-header">
                    <h3>
                        ${g.name}
                        <span class="admin-badge">${g.members.length}</span>
                    </h3>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <a href="/group_dashboards?group=${g.id}" class="action-btn edit-btn" style="text-decoration:none; padding:5px 12px; font-size:0.78rem;">View Dashboard →</a>
                        <button onclick="document.getElementById('inlineAddForm_${g.id}').style.display='block'" class="action-btn edit-btn" style="padding:5px 12px; font-size:0.78rem;">+ Add Meter</button>
                        <button onclick="deleteGroup(${g.id})" class="action-btn delete-btn" style="padding:5px 12px; font-size:0.78rem;">Delete</button>
                    </div>
                </div>
                <div style="padding:0; overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr class="admin-table-header">
                                <th>Plant</th>
                                <th>Meter Name</th>
                                <th>Meter ID</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
                ${addFormHtml}
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

window.deleteGroup = function(id) {
    showCustomConfirmModal({
        title: "Delete Meter Group",
        icon: "📁",
        message: "Are you sure you want to delete this meter group?",
        submessage: "This will remove the group container. Individual meter configurations will remain intact.",
        confirmText: "Delete Group",
        onConfirm: async () => {
            const res = await fetch(`/api/meter_groups/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete group");
            if (window.loadMeterGroups) loadMeterGroups();
        }
    });
};

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

window.removeGroupMember = function(groupId, memberId) {
    showCustomConfirmModal({
        title: "Remove Group Member",
        icon: "⚠️",
        message: "Remove this submeter from the group?",
        submessage: "The submeter will no longer be listed under this group dashboard.",
        confirmText: "Remove Member",
        onConfirm: async () => {
            const res = await fetch(`/api/meter_groups/${groupId}/members/${memberId}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to remove member");
            if (window.loadMeterGroups) loadMeterGroups();
        }
    });
};
