const plantsList = document.getElementById("plantsList");
const noSelectionState = document.getElementById("noSelectionState");
const plantDetailView = document.getElementById("plantDetailView");
const activePlantTitle = document.getElementById("activePlantTitle");
const activePlantSubtitle = document.getElementById("activePlantSubtitle");
const devicesTableBody = document.getElementById("devicesTableBody");

const deviceManagerModal = document.getElementById("deviceManagerModal");
const deviceForm = document.getElementById("deviceForm");
const devError = document.getElementById("devError");
const deviceModalTitle = document.getElementById("deviceModalTitle");

let currentConfigId = null;
let activePlant = null;
let globalGroupedDevices = {};
let globalPlants = [];

// ================= INITIALIZATION =================

document.addEventListener("DOMContentLoaded", () => {
    loadAllDevices();
});

// The global addPlantBtn was removed, devices are now added via plant cards.

// ================= DATA FETCHING & RENDERING =================

function loadAllDevices() {
    Promise.all([
        fetch('/plants').then(res => res.json()),
        fetch('/api/meter_config').then(res => res.json())
    ])
    .then(([plants, devices]) => {
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

    plantsList.innerHTML = "";

    if (document.getElementById("plantCountBadge")) {
        document.getElementById("plantCountBadge").textContent = plants.length;
    }

    if (plants.length === 0) {
        plantsList.innerHTML = `<li style="padding: 20px; text-align: center; color: var(--text-sub); font-size: 0.85rem;">No plants configured yet.</li>`;
        noSelectionState.style.display = "flex";
        plantDetailView.style.display = "none";
        return;
    }

    plants.forEach(plant => {
        const li = document.createElement("li");
        li.className = `plant-item ${plant === activePlant ? "active" : ""}`;
        
        const count = globalGroupedDevices[plant].length;
        li.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg>
                <span class="plant-name-text">${plant}</span>
            </div>
            <span style="font-size:0.75rem; background:rgba(15,23,42,0.2); padding:2px 8px; border-radius:12px; color:var(--text-sub);">
                ${count}
            </span>
        `;
        
        li.addEventListener("click", () => selectPlant(plant));
        plantsList.appendChild(li);
    });

    // If activePlant was deleted or not set, select the first one or show empty state
    if (!activePlant || !plants.includes(activePlant)) {
        if (plants.length > 0) {
            selectPlant(plants[0]);
        } else {
            activePlant = null;
            noSelectionState.style.display = "flex";
            plantDetailView.style.display = "none";
        }
    } else {
        // Re-render the detail view for the active plant in case its devices changed
        renderPlantDetailView();
    }
}

function selectPlant(plantName) {
    activePlant = plantName;
    
    // Update sidebar active class
    const items = plantsList.querySelectorAll(".plant-item");
    items.forEach(item => {
        const textSpan = item.querySelector(".plant-name-text");
        if (textSpan && textSpan.textContent === plantName) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    renderPlantDetailView();
}

window.filterPlants = function() {
    const input = document.getElementById("plantSearchInput").value.toLowerCase();
    const items = plantsList.querySelectorAll(".plant-item");
    items.forEach(item => {
        const textSpan = item.querySelector(".plant-name-text");
        if (textSpan) {
            const text = textSpan.textContent.toLowerCase();
            if (text.includes(input)) {
                item.style.display = "flex";
            } else {
                item.style.display = "none";
            }
        }
    });
};

function renderPlantDetailView() {
    if (!activePlant) return;

    noSelectionState.style.display = "none";
    plantDetailView.style.display = "block";

    const devices = globalGroupedDevices[activePlant] || [];
    
    activePlantTitle.textContent = activePlant;
    activePlantSubtitle.textContent = `${devices.length} device${devices.length !== 1 ? 's' : ''} configured`;

    if (devices.length === 0) {
        devicesTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-sub); padding:40px 20px;">No devices added to this plant yet.</td></tr>`;
        return;
    }

    devicesTableBody.innerHTML = devices.map(dev => {
        const badgeClass = dev.type === "incomer" ? "badge-incomer" : "badge-submeter";
        const badgeLabel = dev.type === "incomer" ? "Main Incomer" : "Submeter";
        return `
        <tr class="admin-table-row">
            <td style="font-weight:600; font-family:'Share Tech Mono',monospace; font-size:0.85rem;">#${dev.meter_id}</td>
            <td style="font-weight:500;">${dev.name}</td>
            <td><span class="badge-type ${badgeClass}">${badgeLabel}</span></td>
            <td style="text-align:right;">
                <div class="actions-dropdown" style="display:inline-block; text-align:left;">
                    <button class="action-btn" style="padding:4px 8px; border:none; background:transparent; color:var(--text-main); cursor:pointer;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                    </button>
                    <div class="dropdown-content" style="min-width:140px; right:20px; top:100%; z-index:999;">
                        <button class="dropdown-item" onclick='editDevice(${JSON.stringify(dev)})'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            Edit Meter
                        </button>
                        <button class="dropdown-item" onclick='deleteDevice(${dev.id})' style="color:#f87171;">
                            <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/><path d='M9 6V4h6v2'/></svg>
                            Delete
                        </button>
                    </div>
                </div>
            </td>
        </tr>`;
    }).join("");
}

window.openDeviceModalForActivePlant = function() {
    if (!activePlant) return;
    window.openDeviceModal(activePlant);
};

window.deleteActivePlant = function() {
    if (!activePlant) return;
    window.deletePlant(activePlant);
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

// ================= THEME TOGGLE (Copied from script.js) =================
const themeToggleBtn = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");

function toggleTheme() {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    applyThemeState();
}

function applyThemeState() {
    const isLight = document.body.classList.contains("light-mode");
    if (isLight) {
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    } else {
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
}

themeToggleBtn?.addEventListener("click", toggleTheme);

// Initialize theme
if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-mode");
}
applyThemeState();

// ================= LOGOUT =================
const logoutBtn = document.getElementById("logoutBtn");
logoutBtn?.addEventListener("click", () => {
    fetch('/api/logout', { method: 'POST' })
        .then(() => {
            window.location.href = "/";
        });
});

// ================= IMPORT CONFIG =================
window.handleImportConfig = function(input) {
    const file = input.files[0];
    if (!file) return;

    const resultBanner = document.getElementById("importResult");
    resultBanner.style.display = "none";

    const formData = new FormData();
    formData.append("file", file);

    // Reset file input so same file can be re-selected if needed
    input.value = "";

    fetch("/api/import_config", {
        method: "POST",
        body: formData
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Import failed");
        return data;
    })
    .then(data => {
        resultBanner.style.background = "linear-gradient(135deg, rgba(22,163,74,0.15), rgba(21,128,61,0.1))";
        resultBanner.style.border = "1px solid rgba(22,163,74,0.4)";
        resultBanner.style.color = "#16a34a";
        resultBanner.innerHTML = `
            ✅ <strong>Config Imported Successfully!</strong>
            &nbsp;|&nbsp; ${data.meters_updated} meter(s) updated
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
