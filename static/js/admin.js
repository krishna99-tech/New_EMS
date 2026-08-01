const plantsContainer = document.getElementById("plantsContainer");
const deviceManagerModal = document.getElementById("deviceManagerModal");
const deviceForm = document.getElementById("deviceForm");
const devError = document.getElementById("devError");
const deviceModalTitle = document.getElementById("deviceModalTitle");

let currentConfigId = null;

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
    plantsContainer.innerHTML = "";
    
    // Group devices by plant
    const grouped = {};
    plants.forEach(p => grouped[p] = []); // Initialize all plants
    
    devices.forEach(dev => {
        if (!grouped[dev.plant]) {
            grouped[dev.plant] = [];
            plants.push(dev.plant); // Safety fallback
        }
        grouped[dev.plant].push(dev);
    });

    if (plants.length === 0) {
        plantsContainer.innerHTML = `<div style="color: var(--text-sub); text-align: center; padding: 40px;">No plants configured yet. Click the button above to create one.</div>`;
        return;
    }

    plants.forEach(plant => {
        const plantSection = document.createElement("div");
        plantSection.className = "admin-plant-card"; // Using the new premium card style
        
        let tableRows = "";
        if (grouped[plant].length === 0) {
            tableRows = `<tr><td colspan="4" style="text-align: center; color: var(--text-sub); padding: 20px;">No devices added to this plant yet.</td></tr>`;
        } else {
            tableRows = grouped[plant].map(dev => {
                const badgeClass = dev.type === "incomer" ? "badge-incomer" : "badge-submeter";
                return `
                <tr class="admin-table-row">
                <td style="font-weight: 500;">#${dev.meter_id}</td>
                <td style="font-weight: 500; color: var(--text-main);">${dev.name}</td>
                <td><span class="badge-type ${badgeClass}">${dev.type}</span></td>
                <td style="text-align: right;">
                    <button class="action-btn edit-btn" onclick='editDevice(${JSON.stringify(dev)})'>Edit</button>
                    <button class="action-btn delete-btn" onclick='deleteDevice(${dev.id})'>Delete</button>
                </td>
            </tr>
            `;
            }).join("");
        }

        plantSection.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; cursor: pointer; gap: 12px; flex: 1;" onclick="togglePlantTable(this)">
                    <svg class="chevron-icon" style="transition: transform 0.3s; transform: rotate(-90deg); color: var(--text-sub);" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    <h3 style="margin: 0; color: var(--text-main); font-size: 1.5rem; letter-spacing: -0.02em;">${plant}</h3>
                </div>
                <button class="submit-btn" style="padding: 8px 16px; font-size: 0.9em; width: auto; border-radius: 8px;" onclick="openDeviceModal('${plant}')">+ Add Device</button>
            </div>
            <div class="plant-table-container" style="overflow-x: auto; display: none; transition: all 0.3s;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr class="admin-table-header">
                            <th>Meter ID</th>
                            <th>Meter Name</th>
                            <th>Type</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;
        plantsContainer.appendChild(plantSection);
    });
}

// ================= MODAL & CRUD LOGIC =================

window.togglePlantTable = function(headerElem) {
    const container = headerElem.parentElement.nextElementSibling;
    const chevron = headerElem.querySelector('.chevron-icon');
    if (container.style.display === "none") {
        container.style.display = "block";
        chevron.style.transform = "rotate(0deg)";
    } else {
        container.style.display = "none";
        chevron.style.transform = "rotate(-90deg)"; // Points right when collapsed
    }
};

window.openDeviceModal = function(plantName = "") {
    deviceModalTitle.innerText = "Add New Device";
    deviceForm.reset();
    
    // Populate plant dropdown
    const devPlantSelect = document.getElementById("devPlant");
    devPlantSelect.innerHTML = '<option value="" disabled selected>Select a Plant...</option>';
    
    fetch('/plants')
        .then(r => r.json())
        .then(plants => {
            plants.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                devPlantSelect.appendChild(opt);
            });
            if (plantName) {
                devPlantSelect.value = plantName;
            }
        });

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
    document.getElementById("devPlant").value = dev.plant;
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
