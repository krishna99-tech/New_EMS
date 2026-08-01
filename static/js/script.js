const plantSelect = document.getElementById("plantSelect");
const meterSelect = document.getElementById("meterSelect");

const cardsContainer =
    document.getElementById("cardsContainer");

const dashboardTitle =
    document.getElementById("dashboardTitle");

const navbar = document.querySelector(".navbar");

const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
const shiftSelect = document.getElementById("shiftSelect");
const fromDateTime = document.getElementById("fromDateTime");
const toDateTime = document.getElementById("toDateTime");
const submitFiltersBtn = document.getElementById("submitFiltersBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const shiftAnalysisToggle = document.getElementById("shiftAnalysisToggle");
const customTimeToggle = document.getElementById("customTimeToggle");
const barGraphToggle = document.getElementById("barGraphToggle");
const shiftDisabledNote = document.getElementById("shiftDisabledNote");
const floatingHomeBtn = document.getElementById("floatingHomeBtn");
const moonIcon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
const sunIcon = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="4.22" x2="19.78" y2="5.64"></line>';

const plantThemes = {
    "Architecture": {
        primaryColor: "#3b82f6", // Blue
        darkBgGradient: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e293b 100%)",
        lightBgGradient: "linear-gradient(135deg, #f1f5f9 0%, #dbeafe 50%, #e0e7ff 100%)"
    },
    "Lamination": {
        primaryColor: "#06b6d4", // Cyan
        darkBgGradient: "linear-gradient(135deg, #0f172a 0%, #112a2a 50%, #1e293b 100%)",
        lightBgGradient: "linear-gradient(135deg, #f1f5f9 0%, #cffafe 50%, #e0e7ff 100%)"
    },
    "Machining": {
        primaryColor: "#8b5cf6", // Purple
        darkBgGradient: "linear-gradient(135deg, #0f172a 0%, #221c35 50%, #1e293b 100%)",
        lightBgGradient: "linear-gradient(135deg, #f1f5f9 0%, #f5f3ff 50%, #e0e7ff 100%)"
    },
    "IG Plant": {
        primaryColor: "#10b981", // Green
        darkBgGradient: "linear-gradient(135deg, #0f172a 0%, #0d221c 50%, #1e293b 100%)",
        lightBgGradient: "linear-gradient(135deg, #f1f5f9 0%, #d1fae5 50%, #e0e7ff 100%)"
    },
    "Foundry": {
        primaryColor: "#f59e0b", // Amber
        darkBgGradient: "linear-gradient(135deg, #0f172a 0%, #2b2211 50%, #1e293b 100%)",
        lightBgGradient: "linear-gradient(135deg, #f1f5f9 0%, #fef3c7 50%, #e0e7ff 100%)"
    }
};
let meterMetaById = {};
let liveEventSource = null;
let pendingStreamRefreshTimer = null;
let streamRefreshInProgress = false;
let lastVisualSignature = "";
let loadDataReqSeq = 0;
let loadBaseReqSeq = 0;

function buildVisualSignature(payload) {
    if (!payload) return "";
    const sanitizeRow = (row) => {
        if (!row) return row;
        const copy = { ...row };
        delete copy.id;
        delete copy.timestamp;
        return copy;
    };

    if (Array.isArray(payload)) {
        return JSON.stringify(payload.map(sanitizeRow));
    }
    return JSON.stringify(sanitizeRow(payload));
}

function hexToRgba(hex, alpha) {
    const safeHex = (hex || "").replace("#", "");
    if (safeHex.length !== 6) return `rgba(47, 124, 248, ${alpha})`;
    const r = parseInt(safeHex.substring(0, 2), 16);
    const g = parseInt(safeHex.substring(2, 4), 16);
    const b = parseInt(safeHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyThemeState() {
    const plant = plantSelect.value;
    const isLightMode = document.body.classList.contains("light-mode");
    const plantTheme = plantThemes[plant];

    let activeGradient = isLightMode
        ? "linear-gradient(135deg, #eef2ff 0%, #dbeafe 45%, #e0e7ff 100%)"
        : "linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #1e293b 100%)";

    if (plantTheme) {
        plantSelect.style.color = plantTheme.primaryColor;
        dashboardTitle.style.color = plantTheme.primaryColor;
        dashboardTitle.style.setProperty("--title-glow", `0 0 15px ${plantTheme.primaryColor}88`);
        navbar.style.setProperty("--nav-border-bottom-color", plantTheme.primaryColor);
        activeGradient = isLightMode ? plantTheme.lightBgGradient : plantTheme.darkBgGradient;

        document.body.style.setProperty("--accent-1", hexToRgba(plantTheme.primaryColor, isLightMode ? 0.13 : 0.25));
        document.body.style.setProperty("--accent-2", hexToRgba(plantTheme.primaryColor, isLightMode ? 0.1 : 0.2));
    } else {
        plantSelect.style.color = "inherit";
        dashboardTitle.style.color = "var(--text-main)";
        dashboardTitle.style.removeProperty("--title-glow");
        navbar.style.setProperty("--nav-border-bottom-color", "transparent");
    }

    document.body.style.setProperty("--dynamic-bg-gradient", activeGradient);
}

// ================= TIME =================

const iconMap = {
    "Voltage": '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>', // Bolt
    "Current": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>', // Activity
    "Frequency": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zm10-3a3 3 0 100 6 3 3 0 000-6z"></path>', // Wave
    "PF": '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-2a8 8 0 100-16 8 8 0 000 16z"></path><path d="M12 8v4l3 3"></path>', // Gauge
    "KW": '<path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"></path>', // Power
    "KVA": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>', // Trending Up
    "Line Voltage": '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>',
    "Line-to-Line Voltage": '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>',
    "Average Voltage": '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>',
    "Voltage Unbalance": '<path d="M3 12h18M12 3v18"></path>',
    "Line Current": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Phase-wise Current L1": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Phase-wise Current L2": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Phase-wise Current L3": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Average Current": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Neutral Line Current": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    "Active Power kW L1": '<path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"></path>',
    "Active Power kW L2": '<path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"></path>',
    "Active Power kW L3": '<path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"></path>',
    "Cumulative kW": '<path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"></path>',
    "Apparent Power kVA L1": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>',
    "Apparent Power kVA L2": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>',
    "Apparent Power kVA L3": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>',
    "Cumulative kVA": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>',
    "Power Factor": '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-2a8 8 0 100-16 8 8 0 000 16z"></path><path d="M12 8v4l3 3"></path>',
    "Frequency": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zm10-3a3 3 0 100 6 3 3 0 000-6z"></path>',
    "kVA Maximum Demand": '<path d="M23 6l-9.5 9.5-5-5L1 18"></path>',
    "Energy Consumption": '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"></path>' // Database/Storage
};

/**
 * Helper to generate the HTML for a single parameter card
 */
function getCardHTML(label, value, unit, status, isEnergy = false, meterName = "", overrides = {}) {
    const icon = isEnergy ? iconMap["Energy Consumption"] : (iconMap[label] || iconMap["Voltage"]);
    const cardClass = status !== 'OK' ? 'card-container error-status' : 'card-container';
    const btnText = overrides.btnText || (status === 'OK' ? (isEnergy ? 'Operational' : 'Device Online') : 'Check Device');
    const normalizedMeterName = meterName || "Meter";
    const titleLabel = overrides.titleLabel || (isEnergy ? `${normalizedMeterName} - Operational` : `${normalizedMeterName} - Live Data`);
    const displayTitle = overrides.displayTitle || (isEnergy ? 'Energy Consumption' : label);
    const description = overrides.description || (isEnergy ? 'Cumulative meter reading' : 'Real-time monitoring active');

    return `
        <div class="${cardClass}">
            <div class="title-card">
                <p>${titleLabel}</p>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${icon}
                </svg>
            </div>
            <div class="card-content">
                <p class="title">${displayTitle}</p>
                <p class="plain">
                    <span>${value ?? 0}</span>
                    <span>${unit}</span>
                </p>
                <p class="description">${description}</p>
                <button class="card-btn">${btnText}</button>
            </div>
        </div>`;
}

function updateTime(){
    const now = new Date();
    const shiftName = getShiftName(now);
    document.getElementById("currentTime").innerText = `${now.toLocaleString()} | ${shiftName}`;
}

setInterval(updateTime,1000);

updateTime();

function getShiftName(dt) {
    const hour = dt.getHours();
    if (hour >= 6 && hour < 14) return "Shift A";
    if (hour >= 14 && hour < 22) return "Shift B";
    return "Shift C";
}

function toLocalInputValue(dt, isDateOnly = false) {
    const pad = n => String(n).padStart(2, "0");
    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    if (isDateOnly) return dateStr;
    return `${dateStr}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function setDefaultDateRange() {
    const isDateOnly = shiftAnalysisToggle.checked;
    const now = new Date();
    const today6 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0);
    if (now < today6) {
        today6.setDate(today6.getDate() - 1);
    }
    const start = new Date(today6);
    start.setDate(start.getDate() - 1);
    const end = new Date(today6);
    fromDateTime.value = toLocalInputValue(start, isDateOnly);
    toDateTime.value = toLocalInputValue(end, isDateOnly);
}

function updateInsightCardsMeta(_extra = {}) {}

function exportCsv() {
    if (exportCsvBtn?.disabled) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Export is disabled when Shift Analysis controls are blocked.</div>`;
        return;
    }

    const plant = plantSelect.value;
    const meter = meterSelect.value;
    const fromValue = fromDateTime.value;
    const toValue = toDateTime.value;

    if (!plant || !meter) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Please select Plant and Meter before exporting CSV.</div>`;
        return;
    }
    if (!fromValue || !toValue) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Please select both From and To date-time before exporting CSV.</div>`;
        return;
    }

    const fromTs = new Date(fromValue).getTime();
    const toTs = new Date(toValue).getTime();
    if (Number.isNaN(fromTs) || Number.isNaN(toTs) || toTs <= fromTs) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Invalid range: To date-time must be greater than From date-time.</div>`;
        return;
    }

    const shiftAnalysisEnabled = shiftAnalysisToggle.checked && !shiftSelect.disabled;
    const selectedShift = shiftSelect.value || "all";
    const url = `/export_csv?plant=${encodeURIComponent(plant)}&meter=${encodeURIComponent(meter)}&from_dt=${encodeURIComponent(fromValue)}&to_dt=${encodeURIComponent(toValue)}&shift_analysis=${encodeURIComponent(shiftAnalysisEnabled)}&shift=${encodeURIComponent(selectedShift)}`;
    window.open(url, "_blank");
}

function closeLiveStream() {
    if (liveEventSource) {
        liveEventSource.close();
        liveEventSource = null;
    }
}

function scheduleRefreshFromStream() {
    if (pendingStreamRefreshTimer) return;
    pendingStreamRefreshTimer = setTimeout(async () => {
        pendingStreamRefreshTimer = null;
        if (streamRefreshInProgress) return;
        streamRefreshInProgress = true;
        try {
            if (!plantSelect.value || !meterSelect.value) return;
            const selectedMeta = meterMetaById[meterSelect.value];
            if (!shiftAnalysisToggle.checked && meterSelect.value !== "all" && selectedMeta && selectedMeta.type === "submeter") {
                // Single submeter card is yesterday snapshot mode (non-live).
                return;
            }
            if (shiftAnalysisToggle.checked && !shiftSelect.disabled) {
                await loadData();
            } else {
                await loadBaseCardsOnMeterSelection();
            }
        } catch (_e) {
            // no-op: stream should continue even if one refresh fails
        } finally {
            streamRefreshInProgress = false;
        }
    }, 300);
}

function getIncomerParams(data) {
    return [
        ["Line Voltage", data.line_voltage ?? data.volt, "V"],
        ["Line-to-Line Voltage", data.line_to_line_voltage ?? data.volt, "V"],
        ["Average Voltage", data.avg_voltage ?? data.volt, "V"],
        ["Voltage Unbalance", data.voltage_unbalance, "%"],
        ["Line Current", data.line_current ?? data.curr, "A"],
        ["Phase-wise Current L1", data.current_l1, "A"],
        ["Phase-wise Current L2", data.current_l2, "A"],
        ["Phase-wise Current L3", data.current_l3, "A"],
        ["Average Current", data.avg_current ?? data.curr, "A"],
        ["Neutral Line Current", data.neutral_line_current, "A"],
        ["Active Power kW L1", data.kw_l1, "kW"],
        ["Active Power kW L2", data.kw_l2, "kW"],
        ["Active Power kW L3", data.kw_l3, "kW"],
        ["Cumulative kW", data.kw_total ?? data.kw, "kW"],
        ["Apparent Power kVA L1", data.kva_l1, "kVA"],
        ["Apparent Power kVA L2", data.kva_l2, "kVA"],
        ["Apparent Power kVA L3", data.kva_l3, "kVA"],
        ["Cumulative kVA", data.kva_total ?? data.kva, "kVA"],
        ["Power Factor", data.pf, ""],
        ["Frequency", data.freq, "Hz"],
        ["kVA Maximum Demand", data.kva_max_demand, "kVA"]
    ];
}

function applyLiveUpdateWithoutRerender(row) {
    if (!row || barGraphToggle.checked || shiftAnalysisToggle.checked || meterSelect.value === "all") return false;
    const selectedMeta = meterMetaById[meterSelect.value];
    if (selectedMeta && selectedMeta.type === "submeter") {
        // Single submeter card is yesterday snapshot mode; do not live-update it.
        return false;
    }
    const cardContents = cardsContainer.querySelectorAll(".card-content");
    if (!cardContents.length) return false;

    const byTitle = {};
    cardContents.forEach(card => {
        const t = card.querySelector(".title")?.textContent?.trim();
        if (t) byTitle[t] = card;
    });

    if (row.meter_type === "submeter") {
        const energyCard = byTitle["Energy Consumption"] || byTitle["Energy"];
        if (!energyCard) return false;
        const spans = energyCard.querySelectorAll(".plain span");
        if (spans[0]) spans[0].textContent = `${row.kwh ?? 0}`;
        if (spans[1]) spans[1].textContent = "kWh";
    } else if (row.meter_type === "incomer") {
        getIncomerParams(row).forEach(([label, value, unit]) => {
            const card = byTitle[label];
            if (!card) return;
            const spans = card.querySelectorAll(".plain span");
            if (spans[0]) spans[0].textContent = `${value ?? 0}`;
            if (spans[1]) spans[1].textContent = unit;
        });
    } else {
        return false;
    }

    const timeNode = cardsContainer.querySelector(".last-updated-info p");
    if (timeNode) timeNode.textContent = `Last Updated: ${row.timestamp || "-"}`;
    return true;
}

function setupLiveStream() {
    closeLiveStream();
    const plant = plantSelect.value;
    const meter = meterSelect.value;
    if (!plant || !meter) return;

    const streamUrl = `/stream_latest?plant=${encodeURIComponent(plant)}&meter=${encodeURIComponent(meter)}`;
    liveEventSource = new EventSource(streamUrl);

    liveEventSource.addEventListener("latest", async (event) => {
        try {
            const payload = JSON.parse(event.data || "{}");
            const rows = Array.isArray(payload.rows) ? payload.rows : [];
            if (rows.length === 1 && applyLiveUpdateWithoutRerender(rows[0])) {
                return;
            }
        } catch (_e) {
            // Fall back to existing refresh flow
        }
        scheduleRefreshFromStream();
    });

    liveEventSource.addEventListener("error", () => {
        // Browser auto-reconnects EventSource by default.
    });
}



function renderLiveOnlyNotice(message) {
    const notice = document.createElement("div");
    notice.style.gridColumn = "1 / -1";
    notice.className = "last-updated-info";
    notice.innerHTML = `<p>${message}</p>`;
    cardsContainer.appendChild(notice);
}

function syncShiftUiForMeter() {
    const meter = meterSelect.value;
    if (!meter) {
        shiftAnalysisToggle.checked = false;
        shiftAnalysisToggle.disabled = true;
        barGraphToggle.checked = false;
        barGraphToggle.disabled = true;
        shiftAnalysisToggle.closest(".tick-card")?.classList.add("disabled-control");
        barGraphToggle.closest(".tick-card")?.classList.add("disabled-control");
        
        shiftSelect.disabled = true;
        fromDateTime.disabled = true;
        toDateTime.disabled = true;
        submitFiltersBtn.disabled = true;
        exportCsvBtn.disabled = true;
        shiftSelect.closest(".select-card")?.classList.toggle("disabled-control", true);
        fromDateTime.closest(".select-card")?.classList.toggle("disabled-control", true);
        toDateTime.closest(".select-card")?.classList.toggle("disabled-control", true);
        submitFiltersBtn.classList.toggle("disabled-control", true);
        exportCsvBtn.classList.toggle("disabled-control", true);
        
        shiftDisabledNote.textContent = "Please select a meter to enable shift analysis and export controls.";
        shiftDisabledNote.style.display = "block";
        return;
    }

    if (meter === "all") {
        shiftAnalysisToggle.checked = false;
        shiftAnalysisToggle.disabled = true;
        barGraphToggle.checked = false;
        barGraphToggle.disabled = true;
        shiftAnalysisToggle.closest(".tick-card")?.classList.add("disabled-control");
        barGraphToggle.closest(".tick-card")?.classList.add("disabled-control");
        
        shiftSelect.disabled = true;
        fromDateTime.disabled = true;
        toDateTime.disabled = true;
        submitFiltersBtn.disabled = true;
        exportCsvBtn.disabled = true;
        shiftSelect.closest(".select-card")?.classList.toggle("disabled-control", true);
        fromDateTime.closest(".select-card")?.classList.toggle("disabled-control", true);
        toDateTime.closest(".select-card")?.classList.toggle("disabled-control", true);
        submitFiltersBtn.classList.toggle("disabled-control", true);
        exportCsvBtn.classList.toggle("disabled-control", true);
        
        shiftDisabledNote.textContent = "All Devices is live-only. Shift analysis and bar graphs are disabled.";
        shiftDisabledNote.style.display = "block";
        return;
    }

    shiftAnalysisToggle.disabled = false;
    customTimeToggle.disabled = false;
    barGraphToggle.disabled = false;
    shiftAnalysisToggle.closest(".tick-card")?.classList.remove("disabled-control");
    customTimeToggle.closest(".tick-card")?.classList.remove("disabled-control");
    barGraphToggle.closest(".tick-card")?.classList.remove("disabled-control");
    const rangeModeEnabled = shiftAnalysisToggle.checked || customTimeToggle.checked || barGraphToggle.checked;
    const shiftDropdownEnabled = shiftAnalysisToggle.checked || barGraphToggle.checked;

    shiftSelect.disabled = !shiftDropdownEnabled;
    fromDateTime.disabled = !rangeModeEnabled;
    toDateTime.disabled = !rangeModeEnabled;
    submitFiltersBtn.disabled = !rangeModeEnabled;
    exportCsvBtn.disabled = !rangeModeEnabled;

    shiftSelect.closest(".select-card")?.classList.toggle("disabled-control", !shiftDropdownEnabled);
    fromDateTime.closest(".select-card")?.classList.toggle("disabled-control", !rangeModeEnabled);
    toDateTime.closest(".select-card")?.classList.toggle("disabled-control", !rangeModeEnabled);
    submitFiltersBtn.classList.toggle("disabled-control", !rangeModeEnabled);
    exportCsvBtn.classList.toggle("disabled-control", !rangeModeEnabled);

    if (shiftAnalysisToggle.checked) {
        fromDateTime.type = "date";
        toDateTime.type = "date";
    } else {
        fromDateTime.type = "datetime-local";
        toDateTime.type = "datetime-local";
    }
    shiftDisabledNote.style.display = "none";
}

function syncFloatingHomeBtn() {
    const landingView = document.getElementById("landingView");
    const showButton = !!(landingView && landingView.style.display === "none");
    floatingHomeBtn?.classList.toggle("hidden", !showButton);
}

// ================= LOAD PLANTS =================

async function loadPlants(){

    const res = await fetch("/plants");

    const plants = await res.json();

    plants.forEach(p=>{

        const option = document.createElement("option");
        option.value = p;

        const theme = plantThemes[p];
        if (theme) {
            option.innerHTML = `&#9679; ${p}`;
            option.style.color = theme.primaryColor;
        } else {
            option.innerHTML = `&#9679; ${p}`;
            option.style.color = "#8b5cf6"; // Default purple
        }

        plantSelect.appendChild(option);
    });
}

// ================= LOAD METERS =================

async function loadMeters(plant){

    meterSelect.innerHTML =
    `<option value="">Select Meter</option>`;
    meterMetaById = {};

    const res =
    await fetch(`/meters?plant=${plant}`);

    const meters = await res.json();

    meters.forEach(m=>{

        const option = document.createElement("option");

        option.value = m.id;
        option.textContent = m.name;
        meterMetaById[m.id] = m;

        meterSelect.appendChild(option);
    });

    // Add "All Devices" option
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Devices (Excluding Main Incomer)";
    meterSelect.appendChild(allOption);
}

// ================= BAR CHART HELPER =================

function getBarChartHTML(title, dataPoints, isFullWidth = false) {
    if (!dataPoints || dataPoints.length === 0) return `<div style="color: var(--text-sub); padding: 20px;">No bar data available.</div>`;

    const safePoints = dataPoints.map(p => ({
        label: p.label,
        value: Number(p.value) || 0,
        unit: p.unit || ""
    }));
    const rawMax = Math.max(...safePoints.map(b => b.value), 0);
    const axisMax = rawMax <= 0 ? 1 : rawMax * 1.1;
    const ticks = [1, 0.75, 0.5, 0.25, 0];
    const formatNum = n => (n >= 100 ? Math.round(n).toString() : n.toFixed(2).replace(/\.00$/, ""));
    const yAxisHtml = ticks.map(t => `<span>${formatNum(axisMax * t)}</span>`).join("");
    const barsHtml = safePoints.map(b => {
        const percent = Math.max(0, Math.min(100, (b.value / axisMax) * 100));
        return `
        <div class="industrial-bar-wrap">
            <div class="industrial-bar-value">${formatNum(b.value)} ${b.unit}</div>
            <div class="industrial-bar-track">
                <div class="industrial-bar-fill" style="height:${percent}%"></div>
            </div>
            <div class="industrial-bar-label" title="${b.label}">${b.label}</div>
        </div>`;
    }).join("");

    const containerStyle = isFullWidth ? 'style="grid-column: 1 / -1; width: 100%;"' : '';

    return `
    <div class="graph-container" ${containerStyle}>
        <h4 class="graph-title">${title}</h4>
        <div class="industrial-chart-shell">
            <div class="industrial-y-axis">
                ${yAxisHtml}
            </div>
            <div class="industrial-plot-area">
                <div class="industrial-grid-lines"></div>
                <div class="industrial-bars">
                    ${barsHtml}
                </div>
            </div>
        </div>
    </div>`;
}

function getTableHTML(title, dataPoints, isFullWidth, isCustom = false) {
    if (!dataPoints || dataPoints.length === 0) return `<div style="color: var(--text-sub); padding: 20px;">No data available.</div>`;

    const rowsHtml = dataPoints.map(p => {
        const startVal = p.start_kwh !== undefined && p.start_kwh !== null ? p.start_kwh.toFixed(2) : "N/A";
        const endVal = p.end_kwh !== undefined && p.end_kwh !== null ? p.end_kwh.toFixed(2) : "N/A";
        return `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 8px;">${p.label}</td>
                <td style="padding: 8px;">${startVal}</td>
                <td style="padding: 8px;">${endVal}</td>
                <td style="padding: 8px;">${p.value} ${p.unit || 'kWh'}</td>
            </tr>
        `;
    }).join("");

    const totalConsumption = dataPoints.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
    const totalRowHtml = dataPoints.length > 1 ? `
        <tr style="border-top: 2px solid var(--border-color); font-weight: bold;">
            <td style="padding: 8px;" colspan="3">Total</td>
            <td style="padding: 8px;">${totalConsumption.toFixed(2)} ${dataPoints[0]?.unit || 'kWh'}</td>
        </tr>
    ` : "";

    const containerStyle = isFullWidth ? 'style="grid-column: 1 / -1; width: 100%;"' : '';

    return `
    <div class="graph-container" ${containerStyle}>
        <h4 class="graph-title">${title}</h4>
        <div class="table-container" style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; color: var(--text-main);">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border-color);">
                        <th style="padding: 8px;">${isCustom ? 'Time Range' : 'Date / Shift'}</th>
                        <th style="padding: 8px;">${isCustom ? 'Start Reading' : 'Shift Start'}</th>
                        <th style="padding: 8px;">${isCustom ? 'End Reading' : 'Shift End'}</th>
                        <th style="padding: 8px;">Consumption</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                ${dataPoints.length > 1 ? `<tfoot>${totalRowHtml}</tfoot>` : ""}
            </table>
        </div>
    </div>`;
}

// ================= CREATE CARDS =================

function createCards(data){

    cardsContainer.innerHTML = "";
    const selectedMeterName = meterSelect.options[meterSelect.selectedIndex]?.text || "Meter";

    // Add timestamp info
    const timeInfo = document.createElement("div");
    timeInfo.style.gridColumn = "1 / -1";
    timeInfo.className = "last-updated-info";
    timeInfo.innerHTML = `<p>Last Updated: ${data.timestamp}</p>`;
    cardsContainer.appendChild(timeInfo);

    // Incomer meter
    if(data.meter_type === "incomer"){

        const params = getIncomerParams(data);

        if (barGraphToggle.checked) {
            params.forEach(p => {
                cardsContainer.insertAdjacentHTML('beforeend', getBarChartHTML(p[0], [{label: "Current", value: p[1] ?? 0, unit: p[2]}]));
            });
        } else {
            params.forEach(p=>{
                cardsContainer.insertAdjacentHTML('beforeend', getCardHTML(p[0], p[1], p[2], data.status, false, selectedMeterName));
            });
        }
    }

    // Submeter KWH (fallback live card)
    if(data.meter_type === "submeter"){
        if (barGraphToggle.checked) {
            const dataPoints = [{label: "Current Energy", value: data.kwh ?? 0, unit: "kWh"}];
            cardsContainer.insertAdjacentHTML('beforeend', getBarChartHTML("Energy Consumption", dataPoints));
        } else {
            cardsContainer.insertAdjacentHTML('beforeend', getCardHTML("Energy", data.kwh, "kWh", data.status, true, selectedMeterName));
        }
    }
}

function renderEnergySummaryCard(summary) {
    const meterName = summary.meter_name || "Meter";
    const hasShiftWindowData = summary.has_shift_window_data !== false;
    const startKwh = summary.range_start_kwh ?? 0;
    const endKwh = summary.range_end_kwh ?? 0;
    const selectedTotal = summary.selected_total_kwh ?? 0;
    const selectedShift = summary.selected_shift || shiftSelect.value || "all";
    const valueUnit = summary.value_unit || "kWh";
    const metricName = summary.metric_name || "Energy Consumption";
    const rangeLabel = `${summary.from_dt || "-"} to ${summary.to_dt || "-"}`;

    cardsContainer.innerHTML = "";
    
    let dataPoints = [];
    if (summary.mode === "custom") {
        if (summary.range_start_kwh !== null || summary.range_end_kwh !== null || summary.selected_total_kwh !== null) {
            dataPoints = [{
                label: `${summary.from_dt} to ${summary.to_dt}`,
                start_kwh: summary.range_start_kwh,
                end_kwh: summary.range_end_kwh,
                value: summary.selected_total_kwh,
                unit: valueUnit
            }];
        }
    } else if (summary.bars && summary.bars.length > 0) {
        dataPoints = summary.bars.map(b => ({
            label: b.label,
            value: b.consumption,
            unit: valueUnit,
            start_kwh: b.start_kwh,
            end_kwh: b.end_kwh
        }));
    }

    if (barGraphToggle.checked) {
        const title = summary.mode === "custom" 
            ? `${metricName} - Custom Range`
            : `${metricName} - ${summary.selected_shift === 'all' ? 'All Shifts' : summary.selected_shift}`;
        cardsContainer.insertAdjacentHTML('beforeend', getBarChartHTML(title, dataPoints, true));
    } else {
        const title = summary.mode === "custom"
            ? `${metricName} Data - Custom Range`
            : `${metricName} Data - ${summary.selected_shift === 'all' ? 'All Shifts' : summary.selected_shift}`;
        cardsContainer.insertAdjacentHTML('beforeend', getTableHTML(title, dataPoints, true, summary.mode === "custom"));
    }
}

async function loadEnergySummary(plant, meter) {
    let from_dt = fromDateTime.value;
    let to_dt = toDateTime.value;
    if (shiftAnalysisToggle.checked) {
        if (from_dt.length === 10) from_dt += "T06:00";
        if (to_dt.length === 10) to_dt += "T06:00";
    }
    const shift = shiftSelect.value || "all";
    const mode = customTimeToggle.checked ? "custom" : "shiftwise";
    const res = await fetch(`/energy_summary?plant=${encodeURIComponent(plant)}&meter=${encodeURIComponent(meter)}&mode=${mode}&shift=${encodeURIComponent(shift)}&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}`);
    if (!res.ok) {
        const errText = await res.text();
        return { error: `Energy summary failed (${res.status}).`, details: errText.slice(0, 180) };
    }
    return res.json();
}

async function loadIncomerShiftSummary(plant, meter) {
    const from_dt = fromDateTime.value;
    const to_dt = toDateTime.value;
    const shift = shiftSelect.value || "all";
    const res = await fetch(`/incomer_shift_summary?plant=${encodeURIComponent(plant)}&meter=${encodeURIComponent(meter)}&shift=${encodeURIComponent(shift)}&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}`);
    if (!res.ok) {
        const errText = await res.text();
        return { error: `Incomer summary failed (${res.status}).`, details: errText.slice(0, 180) };
    }
    return res.json();
}

function renderIncomerShiftGraphs(summary) {
    cardsContainer.innerHTML = "";
    const rangeLabel = `${summary.from_dt || "-"} to ${summary.to_dt || "-"}`;
    cardsContainer.insertAdjacentHTML(
        "beforeend",
        `<div style="grid-column:1 / -1; color: var(--text-sub); font-size: 13px; margin: 0 0 8px 4px;">
            Shift: ${summary.selected_shift === "all" ? "All Shifts" : summary.selected_shift} | Range: ${rangeLabel}
        </div>`
    );

    if (!summary.series || summary.series.length === 0) {
        cardsContainer.insertAdjacentHTML("beforeend", `<div style="color: var(--text-sub); padding: 20px;">No incomer range data available for the selected shift/date range.</div>`);
        return;
    }

    summary.series.forEach(s => {
        const points = (s.bars || []).map(b => ({
            label: b.label,
            value: b.value ?? 0,
            unit: s.unit || ""
        }));
        cardsContainer.insertAdjacentHTML("beforeend", getBarChartHTML(s.label, points));
    });
}

// ================= CREATE CARDS FOR ALL =================

function createCardsForAll(dataArray){

    cardsContainer.innerHTML = "";
    renderLiveOnlyNotice("All Devices data is LIVE. Shift Analysis and Bar Graphs are blocked for this view.");

    dataArray.forEach(d => {

        const meterDiv = document.createElement("div");

        meterDiv.className = "meter-section";
        
        // Create a container for the cards within this section to keep them organized
        const cardGrid = document.createElement("div");
        cardGrid.className = "cards"; // Reuse the grid styling

        meterDiv.innerHTML = `
            <h3 class="meter-section-title">${d.meter_name}</h3>
            <p class="last-updated-info">Last Updated: ${d.timestamp}</p>
        `;

        // Incomer meter
        if(d.meter_type === "incomer"){

            const params = [
                ["Line Voltage", d.line_voltage ?? d.volt, "V"],
                ["Line-to-Line Voltage", d.line_to_line_voltage ?? d.volt, "V"],
                ["Average Voltage", d.avg_voltage ?? d.volt, "V"],
                ["Voltage Unbalance", d.voltage_unbalance, "%"],
                ["Line Current", d.line_current ?? d.curr, "A"],
                ["Phase-wise Current L1", d.current_l1, "A"],
                ["Phase-wise Current L2", d.current_l2, "A"],
                ["Phase-wise Current L3", d.current_l3, "A"],
                ["Average Current", d.avg_current ?? d.curr, "A"],
                ["Neutral Line Current", d.neutral_line_current, "A"],
                ["Active Power kW L1", d.kw_l1, "kW"],
                ["Active Power kW L2", d.kw_l2, "kW"],
                ["Active Power kW L3", d.kw_l3, "kW"],
                ["Cumulative kW", d.kw_total ?? d.kw, "kW"],
                ["Apparent Power kVA L1", d.kva_l1, "kVA"],
                ["Apparent Power kVA L2", d.kva_l2, "kVA"],
                ["Apparent Power kVA L3", d.kva_l3, "kVA"],
                ["Cumulative kVA", d.kva_total ?? d.kva, "kVA"],
                ["Power Factor", d.pf, ""],
                ["Frequency", d.freq, "Hz"],
                ["kVA Maximum Demand", d.kva_max_demand, "kVA"]
            ];

            if (barGraphToggle.checked) {
                params.forEach(p => {
                    cardGrid.insertAdjacentHTML('beforeend', getBarChartHTML(p[0], [{label: "Current", value: p[1] ?? 0, unit: p[2]}]));
                });
            } else {
                params.forEach(p => {
                    cardGrid.insertAdjacentHTML('beforeend', getCardHTML(p[0], p[1], p[2], d.status, false, d.meter_name, {
                        btnText: d.status === "OK" ? "Device Online" : "Check Device",
                        titleLabel: `${d.meter_name} - ${d.status === "OK" ? "Device Online" : "Check Device"}`
                    }));
                });
            }
        }

        // Submeter KWH
        if(d.meter_type === "submeter"){
            if (barGraphToggle.checked) {
                const dataPoints = [{label: "Current Energy", value: d.kwh ?? 0, unit: "kWh"}];
                cardGrid.insertAdjacentHTML('beforeend', getBarChartHTML("Energy Consumption", dataPoints));
            } else {
                cardGrid.insertAdjacentHTML('beforeend', getCardHTML("Energy", d.kwh, "kWh", d.status, true, d.meter_name, {
                    btnText: d.status === "OK" ? "Device Online" : "Check Device",
                    titleLabel: `${d.meter_name} - ${d.status === "OK" ? "Device Online" : "Check Device"}`
                }));
            }
        }

        meterDiv.appendChild(cardGrid);
        cardsContainer.appendChild(meterDiv);
    });
}

// ================= LOAD DATA =================

async function loadData(){
    const reqId = ++loadDataReqSeq;
    if (shiftSelect.disabled) return;

    const plant = plantSelect.value;
    const meter = meterSelect.value;
    const shift = shiftSelect.value;

    // Show data only after required selections.
    if(!plant || !meter || !shift){
        cardsContainer.innerHTML = "";
        updateInsightCardsMeta({ barCount: 0 });
        return;
    }

    const fromValue = fromDateTime.value;
    const toValue = toDateTime.value;
    if (!fromValue || !toValue) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Please select both From and To date-time, then click Submit.</div>`;
        updateInsightCardsMeta({ barCount: 0 });
        return;
    }
    const fromTs = new Date(fromValue).getTime();
    const toTs = new Date(toValue).getTime();
    if (Number.isNaN(fromTs) || Number.isNaN(toTs) || toTs <= fromTs) {
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">Invalid range: To date-time must be greater than From date-time.</div>`;
        updateInsightCardsMeta({ barCount: 0 });
        return;
    }

    dashboardTitle.innerText = `${plant} Dashboard`;
    applyThemeState();

    document.getElementById("liveStatus").style.display = "flex";

    if(meter === "all"){
        const resMeters = await fetch(`/meters?plant=${encodeURIComponent(plant)}`);
        const allMeters = await resMeters.json();
        const submeters = allMeters.filter(m => m.type === "submeter");
        const summaries = await Promise.all(submeters.map(m => loadEnergySummary(plant, m.id)));
        const validSummaries = summaries.filter(s => !s.error);
        if (reqId !== loadDataReqSeq) return;
        createSummaryCardsForAll(validSummaries);
        updateInsightCardsMeta({ barCount: 0 });

    } else {
        const selectedMeta = meterMetaById[meter];
        if (selectedMeta && selectedMeta.type === "incomer" && barGraphToggle.checked) {
            const incomerSummary = await loadIncomerShiftSummary(plant, meter);
            if (incomerSummary.error) {
                cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">${incomerSummary.error}</div>`;
                return;
            }
            if (reqId !== loadDataReqSeq) return;
            renderIncomerShiftGraphs(incomerSummary);
            updateInsightCardsMeta({ barCount: (incomerSummary.series || []).length });
            return;
        }
        if (selectedMeta && (selectedMeta.type === "submeter" || selectedMeta.type === "incomer")) {
            const summary = await loadEnergySummary(plant, meter);
            if (summary.error) {
                cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">${summary.error}</div>`;
                return;
            }
            if (reqId !== loadDataReqSeq) return;
            renderEnergySummaryCard(summary);
            updateInsightCardsMeta({ barCount: (summary.bars || []).length });
            return;
        }

        const res = await fetch(`/latest?plant=${plant}&meter=${meter}`);

        const data = await res.json();

        if (reqId !== loadDataReqSeq) return;
        if(data.length > 0){
            createCards(data[0]);
            updateInsightCardsMeta({ barCount: 0 });
        } else {
            cardsContainer.innerHTML = 
                `<div style="color: var(--text-sub); padding: 20px;">No data recorded yet for this meter.</div>`;
            updateInsightCardsMeta({ barCount: 0 });
        }
    }
}

async function loadBaseCardsOnMeterSelection() {
    const reqId = ++loadBaseReqSeq;
    const plant = plantSelect.value;
    const meter = meterSelect.value;
    const selectedMeta = meterMetaById[meter];
    if (!plant || !meter) {
        cardsContainer.innerHTML = "";
        return;
    }

    dashboardTitle.innerText = `${plant} Dashboard`;
    applyThemeState();
    document.getElementById("liveStatus").style.display = "flex";

    if (meter === "all") {
        const res = await fetch(`/latest?plant=${plant}&meter=all`);
        const allData = await res.json();
        const filteredData = allData
            .map(d => {
                const meterIdKey = String(d.meter_id ?? "");
                const currentMeta = meterMetaById[meterIdKey];
                if (!currentMeta || currentMeta.type !== "submeter") return null;
                return {
                    ...d,
                    meter_name: currentMeta.name,
                    meter_type: currentMeta.type
                };
            })
            .filter(Boolean);
        if (reqId !== loadBaseReqSeq) return;
        const visualSig = buildVisualSignature(filteredData);
        if (visualSig === lastVisualSignature) return;
        lastVisualSignature = visualSig;
        createCardsForAll(filteredData);
        return;
    }

    const res = await fetch(`/latest?plant=${plant}&meter=${meter}`);
    const data = await res.json();
    if (reqId !== loadBaseReqSeq) return;
    if (data.length > 0) {
        if (selectedMeta && selectedMeta.type === "submeter") {
            const meterName = meterSelect.options[meterSelect.selectedIndex]?.text || "Meter";
            const yesterdayRes = await fetch(`/energy_summary?plant=${encodeURIComponent(plant)}&meter=${encodeURIComponent(meter)}&mode=shiftwise&shift=all`);
            const yesterdaySummary = await yesterdayRes.json();
            const yVal = yesterdaySummary.yesterday_total_kwh ?? 0;
            const fromRaw = yesterdaySummary.from_dt || "";
            const toRaw = yesterdaySummary.to_dt || "";
            const baseDateRaw = fromRaw.slice(0, 10);
            let baseDate = "-";
            if (baseDateRaw) {
                const d = new Date(`${baseDateRaw}T00:00:00`);
                if (!Number.isNaN(d.getTime())) {
                    baseDate = d.toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                    });
                }
            }
            const productionWindowText = (fromRaw && toRaw)
                ? `Production Day: ${fromRaw} to ${toRaw}`
                : `Production Day: ${baseDate} 06:00:00 to next day 06:00:00`;
            const visualSig = JSON.stringify({ meter, yVal, baseDate, productionWindowText, status: data[0].status, meterName });
            if (visualSig === lastVisualSignature) return;
            lastVisualSignature = visualSig;
            cardsContainer.innerHTML = "";
            cardsContainer.insertAdjacentHTML(
                "beforeend",
                `<div style="grid-column:1 / -1; color: var(--text-sub); font-size: 13px; margin: 0 0 8px 4px;">
                    Data Date: ${baseDate} (Production Yesterday)
                    <br>${productionWindowText}
                </div>`
            );
            if (barGraphToggle.checked) {
                const dataPoints = [{label: "Yesterday Total", value: yVal, unit: "kWh"}];
                cardsContainer.insertAdjacentHTML("beforeend", getBarChartHTML("Energy Consumption", dataPoints, true));
            } else {
                cardsContainer.insertAdjacentHTML("beforeend", getCardHTML("Yesterday Total Consumption", yVal, "kWh", data[0].status || "OK", true, meterName));
            }
            return;
        }
        const visualSig = buildVisualSignature(data[0]);
        if (visualSig === lastVisualSignature) return;
        lastVisualSignature = visualSig;
        createCards(data[0]);
    } else {
        lastVisualSignature = "";
        cardsContainer.innerHTML = `<div style="color: var(--text-sub); padding: 20px;">No data recorded yet for this meter.</div>`;
    }
}

function createSummaryCardsForAll(summaries) {
    cardsContainer.innerHTML = "";
    summaries.forEach(summary => {
        const meterDiv = document.createElement("div");
        meterDiv.className = "meter-section";
        meterDiv.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--text-main);">${summary.meter_name}</h3>`;
        const cardGrid = document.createElement("div");
        cardGrid.className = "cards";
        let dataPoints = [];
        if (summary.mode === "custom") {
            if (summary.range_start_kwh !== null || summary.range_end_kwh !== null || summary.selected_total_kwh !== null) {
                dataPoints = [{
                    label: `${summary.from_dt} to ${summary.to_dt}`,
                    start_kwh: summary.range_start_kwh,
                    end_kwh: summary.range_end_kwh,
                    value: summary.selected_total_kwh,
                    unit: "kWh"
                }];
            }
        } else if (summary.bars && summary.bars.length > 0) {
            dataPoints = summary.bars.map(b => ({
                label: b.label,
                value: b.consumption,
                unit: "kWh",
                start_kwh: b.start_kwh,
                end_kwh: b.end_kwh
            }));
        }
        
        if (barGraphToggle.checked) {
            cardGrid.insertAdjacentHTML("beforeend", getBarChartHTML("Energy Consumption", dataPoints, true));
        } else {
            cardGrid.insertAdjacentHTML("beforeend", getTableHTML("Energy Consumption", dataPoints, true, summary.mode === "custom"));
        }
        meterDiv.appendChild(cardGrid);
        cardsContainer.appendChild(meterDiv);
    });
}

// ================= EVENTS =================

plantSelect.addEventListener("change", async ()=>{
    const plant = plantSelect.value;
    const landingView = document.getElementById("landingView");
    const dashboardView = document.getElementById("dashboardView");

    if (plant) {
        dashboardTitle.innerText = `${plant} Dashboard`;
        if (landingView) landingView.style.display = "none";
        if (dashboardView) dashboardView.style.display = "block";
        const filterBar = document.getElementById("filterBar");
        if (filterBar) filterBar.style.display = "block";
    } else {
        plantSelect.style.color = "inherit";
        dashboardTitle.innerText = "Energy Monitoring System";
        if (landingView) landingView.style.display = "block";
        if (dashboardView) dashboardView.style.display = "none";
        const filterBar = document.getElementById("filterBar");
        if (filterBar) filterBar.style.display = "none";
    }
    applyThemeState();

    await loadMeters(plantSelect.value);
    
    if (plant) {
        meterSelect.value = "all";
        meterSelect.dispatchEvent(new Event("change"));
    } else {
        syncShiftUiForMeter();
        cardsContainer.innerHTML = "";
        lastVisualSignature = "";
        document.getElementById("liveStatus").style.display = "none";
        setupLiveStream();
    }
    
    syncFloatingHomeBtn();
    updateAuthUI();
});

meterSelect.addEventListener("change", loadBaseCardsOnMeterSelection);
meterSelect.addEventListener("change", syncShiftUiForMeter);
meterSelect.addEventListener("change", setupLiveStream);
meterSelect.addEventListener("change", () => { lastVisualSignature = ""; });
submitFiltersBtn.addEventListener("click", loadData);
exportCsvBtn?.addEventListener("click", exportCsv);
shiftAnalysisToggle.addEventListener("change", () => {
    if (shiftAnalysisToggle.checked) {
        customTimeToggle.checked = false;
    }
    syncShiftUiForMeter();
    if ((shiftAnalysisToggle.checked || customTimeToggle.checked || barGraphToggle.checked) && !shiftSelect.disabled) {
        if(shiftAnalysisToggle.checked) setDefaultDateRange();
        if (plantSelect.value && meterSelect.value) loadData();
    }
});

customTimeToggle.addEventListener("change", () => {
    if (customTimeToggle.checked) {
        shiftAnalysisToggle.checked = false;
    }
    syncShiftUiForMeter();
    if ((shiftAnalysisToggle.checked || customTimeToggle.checked || barGraphToggle.checked) && !shiftSelect.disabled) {
        if(customTimeToggle.checked) setDefaultDateRange();
        if (plantSelect.value && meterSelect.value) loadData();
    }
});
barGraphToggle.addEventListener("change", () => {
    syncShiftUiForMeter();
    lastVisualSignature = "";
    if ((shiftAnalysisToggle.checked || customTimeToggle.checked || barGraphToggle.checked) && !shiftSelect.disabled) {
        loadData();
    } else {
        loadBaseCardsOnMeterSelection();
    }
});
plantSelect.addEventListener("change", () => updateInsightCardsMeta({ barCount: 0 }));
shiftSelect.addEventListener("change", () => updateInsightCardsMeta({ barCount: 0 }));
fromDateTime.addEventListener("change", () => updateInsightCardsMeta({ barCount: 0 }));
toDateTime.addEventListener("change", () => updateInsightCardsMeta({ barCount: 0 }));

floatingHomeBtn?.addEventListener("click", () => {
    const landingView = document.getElementById("landingView");
    const dashboardView = document.getElementById("dashboardView");

    closeLiveStream();
    plantSelect.value = "";
    meterSelect.innerHTML = `<option value="">Select Meter</option>`;
    cardsContainer.innerHTML = "";
    lastVisualSignature = "";

    dashboardTitle.innerText = "Energy Monitoring System";
    plantSelect.style.color = "inherit";
    applyThemeState();

    if (landingView) landingView.style.display = "block";
    if (dashboardView) dashboardView.style.display = "none";
    const filterBar = document.getElementById("filterBar");
    if (filterBar) filterBar.style.display = "none";
    document.getElementById("liveStatus").style.display = "none";

    shiftAnalysisToggle.checked = false;
    barGraphToggle.checked = false;
    syncShiftUiForMeter();
    syncFloatingHomeBtn();
    updateAuthUI();
});
    // ================= SCROLL LISTENER =================
window.addEventListener("scroll", () => {
    if (window.scrollY > 20) {
        navbar.classList.add("is-sticky");
        document.body.style.paddingTop = `${navbar.offsetHeight}px`;
    } else {
        navbar.classList.remove("is-sticky");
        document.body.style.paddingTop = "0px";
    }
});

// ================= THEME TOGGLE =================

function toggleTheme() {
    const isLight = document.body.classList.toggle("light-mode");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    updateThemeIcon(isLight);
    applyThemeState();
}

function updateThemeIcon(isLight) {
    themeIcon.innerHTML = isLight ? moonIcon : sunIcon;
}

themeToggle.addEventListener("click", toggleTheme);

// ================= INIT =================

loadPlants();
setDefaultDateRange();

// Set initial theme
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    updateThemeIcon(true);
} else { // Default to dark if no theme saved or saved as dark
    updateThemeIcon(false);
}

applyThemeState();
updateInsightCardsMeta({ barCount: 0 });
shiftAnalysisToggle.checked = false;
syncShiftUiForMeter();
syncFloatingHomeBtn();
window.addEventListener("beforeunload", closeLiveStream);


// ================= AUTHENTICATION & ADMIN =================

const authBtn = document.getElementById("authBtn");
const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
let isLoggedIn = false;

function checkAuthStatus() {
    fetch('/api/auth_status')
        .then(res => res.json())
        .then(data => {
            isLoggedIn = data.logged_in;
            updateAuthUI();
        })
        .catch(err => console.error("Auth check failed:", err));
}

function updateAuthUI() {
    if (isLoggedIn) {
        authBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
        authBtn.title = "Logout";
    } else {
        authBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>';
        authBtn.title = "Login";
    }
    
    // Hide auth button on specific plant dashboards
    if (plantSelect && plantSelect.value !== "") {
        authBtn.style.display = "none";
    } else {
        authBtn.style.display = "flex";
    }
}

authBtn.addEventListener("click", () => {
    if (isLoggedIn) {
        fetch('/api/logout', { method: 'POST' })
            .then(() => {
                isLoggedIn = false;
                updateAuthUI();
                if(typeof deviceManagerModal !== "undefined" && deviceManagerModal.style.display === "flex") closeDeviceManager();
            });
    } else {
        loginModal.style.display = "flex";
        loginError.style.display = "none";
    }
});

function closeLoginModal() {
    loginModal.style.display = "none";
}

loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;
    
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => {
        if (!res.ok) throw new Error("Invalid credentials");
        return res.json();
    })
    .then(data => {
        if(data.success) {
            isLoggedIn = true;
            // Redirect to admin device manager page immediately after login
            window.location.href = "/admin";
        }
    })
    .catch(err => {
        loginError.style.display = "block";
    });
});

checkAuthStatus();

// ================= CUSTOM DROPDOWN LOGIC =================
function makeCustomDropdown(selectId) {
    return; // Disabled custom glassmorphism dropdown as requested
    const originalSelect = document.getElementById(selectId);
    if (!originalSelect) return;
    
    // Check if wrapper already exists
    if (originalSelect.nextSibling && originalSelect.nextSibling.className === "custom-select-wrapper") {
        return;
    }

    // Hide original select completely
    originalSelect.style.display = "none";

    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";
    originalSelect.parentNode.insertBefore(wrapper, originalSelect.nextSibling);

    const display = document.createElement("div");
    display.className = "custom-select-display";
    
    const displayText = document.createElement("span");
    
    const arrow = document.createElement("div");
    arrow.className = "custom-select-arrow";
    arrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    
    display.appendChild(displayText);
    display.appendChild(arrow);
    wrapper.appendChild(display);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "custom-select-options";
    wrapper.appendChild(optionsContainer);

    function buildOptions() {
        optionsContainer.innerHTML = "";
        const options = originalSelect.options;
        if (options.length > 0 && originalSelect.selectedIndex >= 0) {
            displayText.innerText = options[originalSelect.selectedIndex].text;
        } else {
            displayText.innerText = "Select...";
        }

        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const div = document.createElement("div");
            div.className = "custom-option";
            if (i === originalSelect.selectedIndex) div.classList.add("selected");
            div.innerText = opt.text;
            div.addEventListener("click", (e) => {
                e.stopPropagation();
                originalSelect.selectedIndex = i;
                originalSelect.dispatchEvent(new Event("change"));
                displayText.innerText = opt.text;
                wrapper.classList.remove("open");
                
                // update selected class
                Array.from(optionsContainer.children).forEach(c => c.classList.remove("selected"));
                div.classList.add("selected");
            });
            optionsContainer.appendChild(div);
        }
    }

    buildOptions();

    // Toggle dropdown
    display.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Close all other open dropdowns first
        document.querySelectorAll(".custom-select-wrapper.open").forEach(w => {
            if (w !== wrapper) w.classList.remove("open");
        });
        
        wrapper.classList.toggle("open");
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) {
            wrapper.classList.remove("open");
        }
    });

    // Rebuild options if the original select changes (MutationObserver)
    const observer = new MutationObserver(() => {
        buildOptions();
    });
    observer.observe(originalSelect, { childList: true });
    
    // Also listen to change event from external sources
    originalSelect.addEventListener("change", () => {
        const options = originalSelect.options;
        if (options.length > 0 && originalSelect.selectedIndex >= 0) {
            displayText.innerText = options[originalSelect.selectedIndex].text;
            Array.from(optionsContainer.children).forEach((c, idx) => {
                c.classList.toggle("selected", idx === originalSelect.selectedIndex);
            });
        }
    });
}

// Initialize immediately if DOM is ready, else wait
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        makeCustomDropdown("plantSelect");
        makeCustomDropdown("meterSelect");
        makeCustomDropdown("shiftSelect");
    });
} else {
    makeCustomDropdown("plantSelect");
    makeCustomDropdown("meterSelect");
    makeCustomDropdown("shiftSelect");
}


// ================= NAVBAR OBSERVER =================
// Dynamically track the height of the navbar so the sticky filter bar
// always sits exactly below it, even on mobile when the navbar wraps.
(function() {
    function updateNavbarHeight() {
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            const height = navbar.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--navbar-height', height + 'px');
        }
    }

    // Update on load
    updateNavbarHeight();

    // Update whenever the window is resized or navbar content changes
    const observer = new ResizeObserver(() => {
        updateNavbarHeight();
    });
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        observer.observe(navbar);
    }
})();

