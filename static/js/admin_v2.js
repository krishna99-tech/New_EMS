const plantsGridView = document.getElementById("plantsGridView");
const deviceManagerModal = document.getElementById("deviceManagerModal");
const deviceForm = document.getElementById("deviceForm");
const devError = document.getElementById("devError");
const deviceModalTitle = document.getElementById("deviceModalTitle");

let globalPlants = [];
let globalPlantsDetailed = [];
let globalGroupedDevices = {};
let globalDevices = [];
let globalLocations = [];
let globalHeartbeats = [];
let heartbeatRefreshTimer = null;

// ================= INITIALIZATION =================

document.addEventListener("DOMContentLoaded", () => {
    loadAllDevices();   // calls loadDiscoveredDevices internally after data is ready
    loadDiscoveredDevices();
    loadMeterGroups();
    loadLocations();
    setupWebSocket();
});

// ================= GLOBAL DROPDOWN CLICK HANDLER =================
// Converts all .action-dropdown elements from :hover to click-toggled.
document.addEventListener("click", (e) => {
    const btn = e.target.closest(".action-dropdown-btn");
    if (btn) {
        e.stopPropagation();
        const dropdown = btn.closest(".action-dropdown");
        const isOpen = dropdown.classList.contains("open");
        // Close all open dropdowns first
        document.querySelectorAll(".action-dropdown.open").forEach(d => d.classList.remove("open"));
        // Toggle the clicked one
        if (!isOpen) dropdown.classList.add("open");
        return;
    }
    // Clicked outside — close all dropdowns
    document.querySelectorAll(".action-dropdown.open").forEach(d => d.classList.remove("open"));
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

        // Always render cards — globalPlantsDetailed may or may not be loaded yet.
        // If it IS loaded, location info will show immediately.
        // If not, loadAllDevices() will re-render once it finishes.
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
    const locBadge = d.is_configured && d.plant ? `<tr><td style="padding:4px 0; color:var(--dj-text-sub);">Location</td><td style="padding:4px 0; text-align:right;">📍 ${d.location_name || "Unassigned"}</td></tr>` : "";

    const actionBtn = window.userRole === 'admin' ? (d.is_configured
        ? `<button type="button" class="action-btn edit-btn" style="padding:4px 12px; font-size:0.75rem;" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, true)">Edit</button>
           <button type="button" class="action-btn delete-btn" style="padding:4px 12px; font-size:0.75rem;" onclick="unregisterDevice('${d.device_id}')">Unlink</button>`
        : `<button type="button" class="submit-btn" style="padding:5px 12px; font-size:0.75rem;" onclick="openRegisterDeviceModal('${d.device_id}', '${d.ip_addr}', ${d.meter_count}, false)">Configure</button>`) : "";

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
                ${locBadge}
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

    // Populate location select
    const locSel = document.getElementById("regLocationSelect");
    locSel.innerHTML = '<option value="">Unassigned</option>';
    globalLocations.forEach(loc => {
        const opt = document.createElement("option");
        opt.value = loc.id;
        opt.textContent = loc.name;
        locSel.appendChild(opt);
    });

    // Auto-select location when plant changes
    sel.onchange = () => {
        const selectedPlant = globalPlantsDetailed?.find(p => p.name === sel.value);
        if (selectedPlant && selectedPlant.location_id) {
            locSel.value = selectedPlant.location_id;
        } else {
            locSel.value = "";
        }
    };

    // If editing, pre-select current plant
    if (isEdit) {
        try {
            const cfgRes = await fetch("/api/device_configs");
            const cfgData = await cfgRes.json();
            const existing = cfgData.find(c => c.device_id === deviceId);
            if (existing) {
                sel.value = existing.plant;
                document.getElementById("regDeviceLabel").value = existing.label || "";
                // trigger change to load location
                sel.dispatchEvent(new Event('change'));
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
        device_id:   document.getElementById("regDeviceId").value,
        plant:       document.getElementById("regPlantSelect").value,
        label:       document.getElementById("regDeviceLabel").value.trim(),
        location_id: document.getElementById("regLocationSelect").value ? parseInt(document.getElementById("regLocationSelect").value) : null
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
        fetch('/api/plants_detailed').then(res => res.json()),
        fetch('/api/meter_config').then(res => res.json()),
        fetch('/api/locations').then(res => res.json())
    ])
    .then(([plantsDetailed, devices, locations]) => {
        globalDevices = devices;
        globalPlantsDetailed = plantsDetailed;
        globalPlants = plantsDetailed.map(p => p.name);
        globalLocations = locations;
        
        populateLocationDropdown();
        renderPlants(globalPlants, devices);
        renderLocationsGrid(locations);
        updateAdminStats(globalPlants, devices, window.globalHeartbeats || []);

        // Now that globalPlantsDetailed is ready, fetch & render device cards.
        // This guarantees the Location row and Edit Location button always appear.
        loadDiscoveredDevices();
    })
    .catch(err => {
        console.error("Error fetching data:", err);
        if (plantsGridView) {
            plantsGridView.innerHTML = `<div class="admin-empty-state" style="color:#ef4444;">Failed to load data. Please try again.</div>`;
        }
    });
}

function loadLocations() {
    fetch('/api/locations').then(res => res.json()).then(data => {
        globalLocations = data;
        renderLocationsGrid(data);
        populateLocationDropdown();
    }).catch(e => console.error("Error loading locations", e));
}

function populateLocationDropdown() {
    const dropdownPlant = document.getElementById("newPlantLocation");
    const dropdownGroup = document.getElementById("newGroupLocation");
    const dropdownUpdate = document.getElementById("updateLocationSelect");
    
    let options = '<option value="">Unassigned</option>';
    globalLocations.forEach(loc => {
        options += `<option value="${loc.id}">${loc.name}</option>`;
    });
    
    if (dropdownPlant) dropdownPlant.innerHTML = options;
    if (dropdownGroup) dropdownGroup.innerHTML = options;
    if (dropdownUpdate) dropdownUpdate.innerHTML = options;
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
        const heartbeats = window.globalHeartbeats || [];

        // Count online/offline meters
        let onlineCount = 0;
        plantDevices.forEach(dev => {
            const hb = heartbeats.find(h => h.plant === dev.plant && h.online);
            if (hb && hb.meter_ids && hb.meter_ids.includes(String(dev.meter_id))) onlineCount++;
        });
        const offlineCount = plantDevices.length - onlineCount;

        // Build meter table rows
        let tableRows = "";
        if (plantDevices.length === 0) {
            tableRows = `<tr><td colspan="5" class="psc-empty-row">No meters added yet. Click <strong>+ Add Meter</strong> to begin.</td></tr>`;
        } else {
            tableRows = plantDevices.map(dev => {
                const hb = heartbeats.find(h => h.plant === dev.plant && h.online);
                const isOnline = hb && hb.meter_ids && hb.meter_ids.includes(String(dev.meter_id));
                const statusDot = isOnline
                    ? `<span class="psc-status online">● Online</span>`
                    : `<span class="psc-status offline">● Offline</span>`;
                const typeLabel = dev.type === "incomer"
                    ? `<span class="psc-type-badge incomer">Incomer</span>`
                    : `<span class="psc-type-badge sub">Sub</span>`;
                return `<tr class="admin-table-row">
                    <td>${statusDot}</td>
                    <td><span class="psc-meter-id">#${dev.meter_id}</span></td>
                    <td>${dev.name || '<span style="color:var(--dj-text-sub)">—</span>'}</td>
                    <td>${typeLabel}</td>
                    <td style="text-align:right;">
                        ${window.userRole === 'admin' ? `
                        <button class="action-btn edit-btn psc-action" onclick='editDevice(${JSON.stringify(dev)})'>Edit</button>
                        <button class="action-btn delete-btn psc-action" onclick='deleteDevice(${dev.id})'>Delete</button>
                        ` : '<span style="color:var(--dj-text-sub); font-size: 0.8rem;">View Only</span>'}
                    </td>
                </tr>`;
            }).join("");
        }

        const safeId = plant.replace(/[^a-zA-Z0-9]/g, "_");

        // Online/offline status pills for compact view
        const onlinePill  = onlineCount > 0  ? `<span class="psc-pill online">● ${onlineCount} Online</span>` : "";
        const offlinePill = offlineCount > 0 ? `<span class="psc-pill offline">● ${offlineCount} Offline</span>` : "";
        const noPill      = plantDevices.length === 0 ? `<span class="psc-pill none">No meters</span>` : "";

        const plantDetail = globalPlantsDetailed.find(p => p.name === plant) || { location_name: "Unassigned" };
        const locationBadge = `<div style="font-size: 0.75rem; color: var(--dj-text-sub); margin-top: 4px; display: flex; align-items: center; gap: 4px;">📍 ${plantDetail.location_name || 'Unassigned'}</div>`;

        const card = document.createElement("div");
        card.className = "psc-card";
        card.setAttribute("data-plant", plant);
        card.id = "psc_" + safeId;
        card.innerHTML = `
            <!-- Compact card face (always visible) -->
            <div class="psc-face" onclick="expandPlantCard('${safeId}')" title="Click to manage">
                <div class="psc-face-left">
                    <div class="psc-avatar">🏭</div>
                    <div class="psc-face-info">
                        <div class="psc-plant-name plant-card-name-text">${plant}</div>
                        ${locationBadge}
                        <div class="psc-pills" style="margin-top: 6px;">
                            <span class="psc-pill count">${plantDevices.length} meter${plantDevices.length !== 1 ? "s" : ""}</span>
                            ${onlinePill}${offlinePill}${noPill}
                        </div>
                    </div>
                </div>
                <div class="psc-face-right">
                    <div class="psc-chevron" id="chevron_${safeId}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                </div>
            </div>

            <!-- Full-width management panel (shown on expand) -->
            <div class="psc-panel" id="panel_${safeId}">
                <div class="psc-panel-header">
                    <div class="psc-panel-title">
                        <span style="font-size:1.3rem;">🏭</span>
                        <span>${plant}</span>
                        <span class="psc-panel-count">${plantDevices.length} meter${plantDevices.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div class="psc-panel-btns">
                        <div class="action-dropdown">
                            <button class="action-dropdown-btn">Actions ▾</button>
                            <div class="action-dropdown-content">
                                <a href="/?plant=${encodeURIComponent(plant)}">Dashboard →</a>
                                ${window.userRole === 'admin' ? `
                                <button onclick="window.openDeviceModal('${plant}')">+ Add Meter</button>
                                <button onclick="openUpdateLocationModal('plant', '${plant}', ${plantDetail.location_id || 'null'})">Edit Location</button>
                                <button class="delete-action" onclick="deletePlant('${plant}')">Delete Plant</button>
                                ` : ''}
                            </div>
                        </div>
                        <button class="psc-close-btn" onclick="collapsePlantCard('${safeId}')" title="Close">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
                <div class="psc-panel-body">
                    <table class="psc-table">
                        <thead>
                            <tr class="admin-table-header">
                                <th>Status</th><th>Meter ID</th><th>Name</th><th>Type</th><th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>
        `;
        plantsGridView.appendChild(card);
    });

    updateAdminStats(plants, devices, window.globalHeartbeats || []);
}

window.expandPlantCard = function(safeId) {
    const card    = document.getElementById("psc_" + safeId);
    const panel   = document.getElementById("panel_" + safeId);
    const chevron = document.getElementById("chevron_" + safeId);
    if (!card || !panel) return;

    // Close any other open cards first
    document.querySelectorAll(".psc-card.expanded").forEach(c => {
        if (c !== card) {
            c.classList.remove("expanded");
            const otherId = c.id.replace("psc_", "");
            const otherPanel = document.getElementById("panel_" + otherId);
            const otherChev  = document.getElementById("chevron_" + otherId);
            if (otherPanel) otherPanel.classList.remove("open");
            if (otherChev)  otherChev.style.transform = "";
        }
    });

    const isOpen = card.classList.toggle("expanded");
    panel.classList.toggle("open", isOpen);
    if (chevron) chevron.style.transform = isOpen ? "rotate(180deg)" : "";
};

window.collapsePlantCard = function(safeId) {
    const card    = document.getElementById("psc_" + safeId);
    const panel   = document.getElementById("panel_" + safeId);
    const chevron = document.getElementById("chevron_" + safeId);
    if (card) card.classList.remove("expanded");
    if (panel) panel.classList.remove("open");
    if (chevron) chevron.style.transform = "";
};

window.filterPlants = function() {
    const input = document.getElementById("plantSearchInput").value.toLowerCase();
    const panels = plantsGridView.querySelectorAll(".psc-card");
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

    if (window.globalPlants && window.globalPlants.map(p => p.toLowerCase()).includes(name.toLowerCase())) {
        plantError.innerText = "A plant with this name already exists.";
        plantError.style.display = "block";
        return;
    }

    const locId = document.getElementById("newPlantLocation") ? document.getElementById("newPlantLocation").value : "";
    const payload = { name: name };
    if (locId) payload.location_id = parseInt(locId);

    fetch("/api/plants", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            closePlantModal();
            loadAllDevices();
        } else {
            plantError.innerText = data.error || data.detail || "Failed to create plant.";
            plantError.style.display = "block";
        }
    })
    .catch(err => {
        console.error("Error creating plant:", err);
        plantError.innerText = "Network error. Please try again.";
        plantError.style.display = "block";
    });
});

window.showToast = function(message, type="success") {
    const container = document.getElementById("adminToastContainer");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `admin-toast ${type}`;
    const icon = type === "success" ? "✅" : "❌";
    
    toast.innerHTML = `
        <span class="admin-toast-icon">${icon}</span>
        <span style="flex:1;">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add("show");
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// ================= DATA LOADING =================

// ================= LOCATIONS LOGIC =================

const INLINE_LOC_ID = "__inline_add_location__";

window.openCreateLocationModal = function() {
    // If already open, just focus
    if (document.getElementById("dynamicLocationModal")) {
        document.getElementById("dynLocName")?.focus();
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = "dynamicLocationModal";
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(3px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.15s ease;
    `;
    overlay.innerHTML = `
        <div style="
            background: var(--dj-bg, #fff);
            border: 1px solid var(--dj-border, #e2e8f0);
            border-radius: 6px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
            animation: slideDown 0.2s ease;
        ">
            <!-- Header -->
            <div style="background: var(--dj-header-bg, #417690); color: #fff; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.1rem;">📍</span>
                    <h3 style="margin:0; font-size:1rem; font-weight:600;">Add New Location</h3>
                </div>
                <button onclick="closeCreateLocationModal()" style="background:transparent; border:none; color:#fff; font-size:1.4rem; cursor:pointer; line-height:1; opacity:0.8;">&times;</button>
            </div>
            <!-- Body -->
            <div style="padding: 24px;">
                <form id="dynLocForm">
                    <div style="margin-bottom: 18px;">
                        <label for="dynLocName" style="display:block; font-size:0.78rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--dj-text-sub); margin-bottom:6px;">Location Name</label>
                        <input type="text" id="dynLocName" required placeholder="e.g. Chennai, Building A, Floor 2..."
                            style="width:100%; padding:9px 12px; border:1px solid var(--dj-border, #cbd5e1); border-radius:4px; background:var(--dj-bg,#fff); color:var(--dj-text,#1e293b); font-size:0.92rem; box-sizing:border-box; outline:none;">
                    </div>
                    <p id="dynLocError" style="display:none; color:var(--dj-danger,#dc2626); font-size:0.83rem; margin-bottom:12px;"></p>
                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button type="button" class="action-btn" onclick="closeCreateLocationModal()">Cancel</button>
                        <button type="submit" class="submit-btn">Save Location</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Close on backdrop click
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeCreateLocationModal();
    });

    document.body.appendChild(overlay);
    document.getElementById("dynLocName")?.focus();

    // Form submit
    document.getElementById("dynLocForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById("dynLocName").value.trim();
        const err = document.getElementById("dynLocError");
        if (!nameInput) return;

        if (window.globalLocations && window.globalLocations.find(l => l.name.toLowerCase() === nameInput.toLowerCase())) {
            err.textContent = "A location with this name already exists.";
            err.style.display = "block";
            return;
        }
        err.style.display = "none";

        try {
            const res = await fetch("/api/locations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: nameInput })
            });
            if (res.ok) {
                closeCreateLocationModal();
                showToast(`Location "${nameInput}" created successfully`);
                loadLocations();
            } else {
                const data = await res.json();
                err.textContent = data.detail || "Failed to create location";
                err.style.display = "block";
            }
        } catch (ex) {
            err.textContent = "Network error. Please try again.";
            err.style.display = "block";
        }
    });
};

window.closeCreateLocationModal = function() {
    const modal = document.getElementById("dynamicLocationModal");
    if (modal) modal.remove();
    // Also hide legacy modal if present
    const legacy = document.getElementById("createLocationModal");
    if (legacy) legacy.style.display = "none";
    // Remove inline card if present
    const card = document.getElementById(INLINE_LOC_ID);
    if (card) card.remove();
};


window.deleteLocation = async function(id) {
    if(!confirm("Are you sure you want to delete this location? Plants in this location will be unassigned.")) return;
    try {
        const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
        if(res.ok) {
            showToast("Location deleted successfully");
            loadAllDevices(); // Reload everything to update plants and locations
        } else {
            showToast("Failed to delete location", "error");
        }
    } catch(err) {
        console.error(err);
        showToast("Network error", "error");
    }
};

window.openUpdateLocationModal = function(type, id, currentLocationId) {
    document.getElementById("updateLocationType").value = type;
    document.getElementById("updateLocationId").value = id;
    document.getElementById("updateLocationSelect").value = currentLocationId || "";
    document.getElementById("updateLocationError").style.display = "none";
    document.getElementById("updateLocationModal").style.display = "flex";
};

window.closeUpdateLocationModal = function() {
    document.getElementById("updateLocationModal").style.display = "none";
};

document.getElementById("updateLocationForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("updateLocationType").value;
    const id = document.getElementById("updateLocationId").value;
    const locId = document.getElementById("updateLocationSelect").value;
    const errEl = document.getElementById("updateLocationError");
    
    let url = "";
    if (type === "plant") {
        url = `/api/plants/${encodeURIComponent(id)}/location`;
    } else if (type === "group") {
        url = `/api/meter_groups/${id}/location`;
    }
    
    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ location_id: locId ? parseInt(locId) : null })
        });
        if (res.ok) {
            closeUpdateLocationModal();
            loadAllDevices(); // Refreshes both plants and locations views
            if (type === "group") loadMeterGroups(); // Refresh groups view
            showToast(`Location updated successfully for ${type}`);
        } else {
            const data = await res.json();
            errEl.innerHTML = `<span style='color:red;'>${data.detail || 'Failed to update location'}</span>`;
            errEl.style.display = "block";
        }
    } catch (err) {
        errEl.innerHTML = `<span style='color:red;'>Network error</span>`;
        errEl.style.display = "block";
    }
});

function renderLocationsGrid(locations) {
    const grid = document.getElementById("locationsGridView");
    if (!grid) return;
    grid.innerHTML = "";
    
    if (document.getElementById("statLocations")) {
        document.getElementById("statLocations").textContent = locations.length;
    }
    
    if (locations.length === 0) {
        grid.innerHTML = `<div class="admin-empty-state">No locations configured yet. Create one to organize your plants.</div>`;
        return;
    }
    
    locations.forEach(loc => {
        const plantsInLoc = globalPlantsDetailed.filter(p => p.location_id === loc.id);
        const pCount = plantsInLoc.length;
        
        const groupsInLoc = typeof globalMeterGroups !== "undefined" ? globalMeterGroups.filter(g => g.location_id === loc.id) : [];
        const gCount = groupsInLoc.length;

        const safeId = "loc_" + loc.id;

        // ── Plants sub-section ──────────────────────────────────────────────────
        const plantRowsHtml = plantsInLoc.length === 0
            ? `<tr><td colspan="3" class="psc-empty-row" style="padding:10px 14px; color:var(--dj-text-sub); font-size:0.85rem;">No plants assigned to this location.</td></tr>`
            : plantsInLoc.map(p => {
                const devs = globalDevices.filter(d => d.plant === p.name);
                return `
                    <tr class="admin-table-row">
                        <td><span style="font-size:1rem; margin-right:6px;">🏭</span><span style="font-weight:600;">${p.name}</span></td>
                        <td>${devs.length} meter(s)</td>
                        <td style="text-align:right;">
                            <a href="/?plant=${encodeURIComponent(p.name)}" class="action-btn" style="text-decoration:none; font-size:0.75rem;">Dashboard →</a>
                        </td>
                    </tr>
                `;
              }).join("");

        // ── Groups sub-section ──────────────────────────────────────────────────
        const groupRowsHtml = groupsInLoc.length === 0
            ? `<tr><td colspan="3" class="psc-empty-row" style="padding:10px 14px; color:var(--dj-text-sub); font-size:0.85rem;">No meter groups assigned to this location.</td></tr>`
            : groupsInLoc.map(g => `
                    <tr class="admin-table-row">
                        <td><span style="font-size:1rem; margin-right:6px;">📂</span><span style="font-weight:600;">${g.name}</span></td>
                        <td>${g.members.length} meter(s)</td>
                        <td style="text-align:right;">
                            <a href="/group_dashboards?group=${g.id}" class="action-btn" style="text-decoration:none; font-size:0.75rem;">Dashboard →</a>
                        </td>
                    </tr>
                `).join("");
        
        const card = document.createElement("div");
        card.className = "psc-card";
        card.id = safeId;
        card.innerHTML = `
            <!-- Compact card face -->
            <div class="psc-face" onclick="expandLocationCard('${safeId}')" title="Click to manage">
                <div class="psc-face-left">
                    <div class="psc-avatar" style="font-size:1rem;">📍</div>
                    <div class="psc-face-info">
                        <div class="psc-plant-name plant-card-name-text">${loc.name}</div>
                        <div class="psc-pills" style="margin-top:6px;">
                            <span class="psc-pill count" style="background:rgba(65, 118, 144, 0.1); color:var(--dj-header-bg); border-color:rgba(65, 118, 144, 0.2);">${pCount} Plant${pCount !== 1 ? 's' : ''}</span>
                            <span class="psc-pill count" style="background:rgba(16, 185, 129, 0.1); color:#10b981; border-color:rgba(16, 185, 129, 0.2);">${gCount} Group${gCount !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                </div>
                <div class="psc-face-right">
                    <div class="psc-chevron" id="chevron_${safeId}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                </div>
            </div>

            <!-- Full-width management panel -->
            <div class="psc-panel" id="panel_${safeId}">
                <div class="psc-panel-header">
                    <div class="psc-panel-title">
                        <span style="font-size:1.2rem;">📍</span>
                        <span>${loc.name}</span>
                    </div>
                    <div class="psc-panel-btns">
                        ${window.userRole === 'admin' ? `
                        <div class="action-dropdown">
                            <button class="action-dropdown-btn">Actions ▾</button>
                            <div class="action-dropdown-content">
                                <button class="delete-action" onclick="deleteLocation(${loc.id})">Delete Location</button>
                            </div>
                        </div>
                        ` : ''}
                        <button class="psc-close-btn" onclick="collapseLocationCard('${safeId}')" title="Close">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
                <div class="psc-panel-body" style="padding:0; display:grid; grid-template-columns:1fr 1fr; min-height:0;">

                    <!-- ── Plants Column ── -->
                    <div style="border-right: 1px solid var(--dj-border, #e2e8f0);">
                        <div style="display:flex; align-items:center; gap:8px; padding:10px 18px; background:var(--dj-bg-sub, #f8f9fa); border-bottom:1px solid var(--dj-border, #e2e8f0);">
                            <span style="font-size:1rem;">🏭</span>
                            <span style="font-weight:700; font-size:0.82rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--dj-text-sub);">Plants</span>
                            <span style="background:rgba(65,118,144,0.15); color:var(--dj-header-bg); border:1px solid rgba(65,118,144,0.25); border-radius:10px; padding:1px 8px; font-size:0.72rem; font-weight:700;">${pCount}</span>
                        </div>
                        <table class="psc-table">
                            <thead>
                                <tr class="admin-table-header">
                                    <th>Plant Name</th>
                                    <th>Meters</th>
                                    <th style="text-align:right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${plantRowsHtml}</tbody>
                        </table>
                    </div>

                    <!-- ── Meter Groups Column ── -->
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; padding:10px 18px; background:var(--dj-bg-sub, #f8f9fa); border-bottom:1px solid var(--dj-border, #e2e8f0);">
                            <span style="font-size:1rem;">📂</span>
                            <span style="font-weight:700; font-size:0.82rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--dj-text-sub);">Meter Groups</span>
                            <span style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:1px 8px; font-size:0.72rem; font-weight:700;">${gCount}</span>
                        </div>
                        <table class="psc-table">
                            <thead>
                                <tr class="admin-table-header">
                                    <th>Group Name</th>
                                    <th>Meters</th>
                                    <th style="text-align:right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${groupRowsHtml}</tbody>
                        </table>
                    </div>

                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.expandLocationCard = function(safeId) {
    document.querySelectorAll("#locationsGridView .psc-card.expanded").forEach(c => {
        if (c.id !== safeId) collapseLocationCard(c.id);
    });
    
    const card = document.getElementById(safeId);
    if (!card) return;
    card.classList.add("expanded");
    
    const panel = document.getElementById("panel_" + safeId);
    if (panel) panel.classList.add("open");
    
    const chev = document.getElementById("chevron_" + safeId);
    if (chev) chev.style.transform = "rotate(180deg)";
};

window.collapseLocationCard = function(safeId) {
    const card = document.getElementById(safeId);
    if (!card) return;
    card.classList.remove("expanded");
    
    const panel = document.getElementById("panel_" + safeId);
    if (panel) panel.classList.remove("open");
    
    const chev = document.getElementById("chevron_" + safeId);
    if (chev) chev.style.transform = "rotate(0deg)";
};


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
            showToast("Device deleted successfully");
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
            showToast("Plant deleted successfully");
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
        showToast("Device saved successfully");
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
            
            // Re-render locations grid so it shows the correct group counts
            if (typeof globalLocations !== "undefined" && globalLocations.length > 0) {
                renderLocationsGrid(globalLocations);
            }
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
        showToast(`Group "${data.name}" created successfully`);
        loadMeterGroups();
    } catch (e) {
        showToast(e.message || "Failed to create preset group", "error");
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

    // Determine which groups pass the filter
    const groups = globalMeterGroups.filter(g =>
        filterVal === "all" || g.id.toString() === filterVal
    );

    if (groups.length === 0) {
        list.innerHTML = `<div class="admin-empty-state">No groups match the current filter.</div>`;
        updateGroupStats();
        return;
    }

    // Build plant options for inline add-meter form
    let plantOptions = '<option value="" disabled selected>Select a Plant...</option>';
    globalPlants.forEach(p => { plantOptions += `<option value="${p}">${p}</option>`; });

    list.innerHTML = "";

    groups.forEach(g => {
        const safeId = "grp_" + g.id;

        // Meter table rows
        let tableRows = "";
        if (g.members.length === 0) {
            tableRows = `<tr><td colspan="4" class="psc-empty-row">No meters assigned yet. Use <strong>+ Add Meter</strong> below.</td></tr>`;
        } else {
            tableRows = g.members.map(m => `
                <tr class="admin-table-row">
                    <td><span class="psc-pill count" style="border-radius:4px;">${m.plant}</span></td>
                    <td>${m.meter_name || '<span style="color:var(--dj-text-sub)">—</span>'}</td>
                    <td><span class="psc-meter-id">#${m.meter_id}</span></td>
                    <td style="text-align:right;">
                        ${window.userRole === 'admin' ? `<button onclick="removeGroupMember(${g.id}, ${m.id})" class="action-btn delete-btn psc-action">Remove</button>` : '<span style="color:var(--dj-text-sub); font-size: 0.8rem;">View Only</span>'}
                    </td>
                </tr>
            `).join("");
        }

        // Inline add-meter form (inside panel)
        const addFormHtml = `
            <div id="inlineAddForm_${g.id}" style="display:none; padding:14px 18px; border-top:1px solid var(--dj-border,#e2e8f0); background:var(--dj-bg-sub,#f8f9fa);">
                <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                    <div class="form-group" style="flex:1; min-width:130px; margin:0;">
                        <label for="inlinePlant_${g.id}" style="font-size:0.78rem; font-weight:600; color:var(--dj-text-sub);">Plant</label>
                        <select id="inlinePlant_${g.id}" onchange="populateInlineMeterSelect(${g.id})" style="margin-top:4px; width:100%; padding:7px 10px; border:1px solid var(--dj-border,#e2e8f0); border-radius:6px; background:var(--dj-bg,#fff); color:var(--dj-text,#1e293b); font-size:0.85rem;">
                            ${plantOptions}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; min-width:130px; margin:0;">
                        <label for="inlineMeter_${g.id}" style="font-size:0.78rem; font-weight:600; color:var(--dj-text-sub);">Meter</label>
                        <select id="inlineMeter_${g.id}" style="margin-top:4px; width:100%; padding:7px 10px; border:1px solid var(--dj-border,#e2e8f0); border-radius:6px; background:var(--dj-bg,#fff); color:var(--dj-text,#1e293b); font-size:0.85rem;">
                            <option value="" disabled selected>Select Plant first...</option>
                        </select>
                    </div>
                    <button type="button" class="submit-btn" style="padding:8px 16px; flex-shrink:0;" onclick="submitInlineAddMember(${g.id})">Add</button>
                    <button type="button" class="action-btn" style="padding:8px 12px; flex-shrink:0; border:1px solid var(--dj-border,#e2e8f0);" onclick="document.getElementById('inlineAddForm_${g.id}').style.display='none'">Cancel</button>
                </div>
                <p id="inlineError_${g.id}" style="display:none; margin-top:8px; margin-bottom:0; color:var(--dj-danger,#dc2626); font-size:0.83rem;"></p>
            </div>
        `;

        const locationBadge = `<div style="font-size: 0.75rem; color: var(--dj-text-sub); margin-top: 4px; display: flex; align-items: center; gap: 4px;">📍 ${g.location_name || 'Unassigned'}</div>`;

        const card = document.createElement("div");
        card.className = "psc-card";
        card.setAttribute("data-group-id", g.id);
        card.id = safeId;
        card.innerHTML = `
            <!-- Compact card face -->
            <div class="psc-face" onclick="expandGroupCard('${safeId}')" title="Click to manage">
                <div class="psc-face-left">
                    <div class="psc-avatar" style="font-size:1rem;">📂</div>
                    <div class="psc-face-info">
                        <div class="psc-plant-name plant-card-name-text">${g.name}</div>
                        ${locationBadge}
                        <div class="psc-pills" style="margin-top:6px;">
                            <span class="psc-pill count">${g.members.length} meter${g.members.length !== 1 ? "s" : ""}</span>
                        </div>
                    </div>
                </div>
                <div class="psc-face-right">
                    <div class="psc-chevron" id="chevron_${safeId}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                </div>
            </div>

            <!-- Full-width management panel -->
            <div class="psc-panel" id="panel_${safeId}">
                <div class="psc-panel-header">
                    <div class="psc-panel-title">
                        <span style="font-size:1.2rem;">📂</span>
                        <span>${g.name}</span>
                        <span class="psc-panel-count">${g.members.length} meter${g.members.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div class="psc-panel-btns">
                        <div class="action-dropdown">
                            <button class="action-dropdown-btn">Actions ▾</button>
                            <div class="action-dropdown-content">
                                <a href="/group_dashboards?group=${g.id}">View Dashboard →</a>
                                ${window.userRole === 'admin' ? `
                                <button onclick="document.getElementById('inlineAddForm_${g.id}').style.display='block'">+ Add Meter</button>
                                <button onclick="openUpdateLocationModal('group', ${g.id}, ${g.location_id || 'null'})">Edit Location</button>
                                <button class="delete-action" onclick="deleteGroup(${g.id})">Delete Group</button>
                                ` : ''}
                            </div>
                        </div>
                        <button class="psc-close-btn" onclick="collapseGroupCard('${safeId}')" title="Close">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
                <div class="psc-panel-body">
                    <table class="psc-table">
                        <thead>
                            <tr class="admin-table-header">
                                <th>Plant</th><th>Meter Name</th><th>Meter ID</th><th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
                ${addFormHtml}
            </div>
        `;
        list.appendChild(card);
    });

    updateGroupStats();
}

window.expandGroupCard = function(safeId) {
    const card    = document.getElementById(safeId);
    const panel   = document.getElementById("panel_" + safeId);
    const chevron = document.getElementById("chevron_" + safeId);
    if (!card || !panel) return;

    // Close any other open group cards
    document.querySelectorAll("#meterGroupsList .psc-card.expanded").forEach(c => {
        if (c !== card) {
            c.classList.remove("expanded");
            const otherId = c.id;
            const otherPanel  = document.getElementById("panel_" + otherId);
            const otherChevron = document.getElementById("chevron_" + otherId);
            if (otherPanel)  otherPanel.classList.remove("open");
            if (otherChevron) otherChevron.style.transform = "";
        }
    });

    const isOpen = card.classList.toggle("expanded");
    panel.classList.toggle("open", isOpen);
    if (chevron) chevron.style.transform = isOpen ? "rotate(180deg)" : "";
};

window.collapseGroupCard = function(safeId) {
    const card    = document.getElementById(safeId);
    const panel   = document.getElementById("panel_" + safeId);
    const chevron = document.getElementById("chevron_" + safeId);
    if (card)    card.classList.remove("expanded");
    if (panel)   panel.classList.remove("open");
    if (chevron) chevron.style.transform = "";
};

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
    const locId = document.getElementById("newGroupLocation") ? document.getElementById("newGroupLocation").value : "";
    const err = document.getElementById("groupError");
    
    if (window.globalMeterGroups && window.globalMeterGroups.find(g => g.name.toLowerCase() === name.toLowerCase())) {
        err.innerText = "A group with this name already exists.";
        err.style.display = "block";
        return;
    }
    
    const payload = { name: name };
    if (locId) payload.location_id = parseInt(locId);

    try {
        const res = await fetch("/api/meter_groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeCreateGroupModal();
            showToast("Group created successfully");
            loadMeterGroups();
        } else {
            const data = await res.json();
            err.innerText = data.detail || "Failed to create group";
            err.style.display = "block";
        }
    } catch (error) {
        console.error("Group error:", error);
        err.innerText = "Network error.";
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
