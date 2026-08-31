// group_dashboard.js

const groupIdInput = document.getElementById("groupIdInput");
let groupId = groupIdInput ? groupIdInput.value : null;

const groupSelect = document.getElementById("groupSelect");
const liveViewContainer = document.getElementById("liveViewContainer");
const historyViewContainer = document.getElementById("historyViewContainer");
const btnGroupLive = document.getElementById("btnGroupLive");
const btnGroupHistory = document.getElementById("btnGroupHistory");
const groupTitle = document.getElementById("groupTitle");
const cardsContainer = document.getElementById("cardsContainer");
const historyCardsContainer = document.getElementById("historyCardsContainer");
const liveKpiStrip = document.getElementById("liveKpiStrip");
const historySummaryStrip = document.getElementById("historySummaryStrip");

let currentViewMode = "live";
let livePollingInterval = null;
let currentGroupMeta = null;

btnGroupLive.addEventListener("click", () => setViewMode("live"));
btnGroupHistory.addEventListener("click", () => setViewMode("history"));

if (groupSelect) {
    groupSelect.addEventListener("change", (e) => {
        groupId = e.target.value;
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('group', groupId);
        window.history.pushState({}, '', newUrl);
        
        loadGroupMeta();
        setViewMode(currentViewMode);
    });
}

function setViewMode(mode) {
    currentViewMode = mode;
    const filterPanel = document.getElementById("groupHistoryFilterPanel");
    
    if (mode === "live") {
        btnGroupLive.classList.add("active");
        btnGroupHistory.classList.remove("active");
        liveViewContainer.style.display = "block";
        historyViewContainer.style.display = "none";
        if (filterPanel) filterPanel.style.display = "none";
        loadLiveData();
        startLivePolling();
    } else {
        btnGroupLive.classList.remove("active");
        btnGroupHistory.classList.add("active");
        liveViewContainer.style.display = "none";
        historyViewContainer.style.display = "block";
        if (filterPanel) filterPanel.style.display = "block";
        stopLivePolling();
        loadHistoryData();
    }
}

// Bind filter submit button
document.getElementById("submitFiltersBtn")?.addEventListener("click", () => {
    if (currentViewMode === "history") {
        loadHistoryData();
    }
});

async function loadGroupMeta() {
    try {
        const res = await fetch("/api/meter_groups");
        const groups = await res.json();
        
        if (groupSelect) {
            groupSelect.innerHTML = '<option value="" disabled>Select a Group...</option>';
            groups.forEach(g => {
                const opt = document.createElement("option");
                opt.value = g.id;
                opt.textContent = g.name;
                groupSelect.appendChild(opt);
            });
            if (groupId) {
                groupSelect.value = groupId;
            } else if (groups.length > 0) {
                groupId = groups[0].id;
                groupSelect.value = groupId;
                setViewMode(currentViewMode);
            }
        }
        
        currentGroupMeta = groups.find(g => g.id == groupId);
    } catch (e) {
        console.error("Failed to load group meta", e);
    }
}

async function loadLiveData() {
    if (!groupId) return;
    try {
        const res = await fetch(`/api/group_live_kpis?group_id=${groupId}`);
        const data = await res.json();
        renderLiveView(data);
    } catch (e) {
        console.error("Failed to load live data", e);
    }
}

function renderLiveView(data) {
    liveKpiStrip.innerHTML = "";
    cardsContainer.innerHTML = "";
    
    if (!data || !data.meters) {
        cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>No live data available for this group.</p></div>`;
        return;
    }

    // Render KPI Strip for the group (Django style)
    const stripHtml = `
        <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Today's Consumption</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${(data.today_consumption_kwh || 0).toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub);">kWh</span></div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Members Online</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${data.online_count} <span style="font-size:14px; color:var(--dj-text-sub);">/ ${data.member_count}</span></div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Shift Consumption</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${(data.current_shift_consumption_kwh || 0).toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub);">kWh</span></div>
            </div>
        </div>
    `;
    liveKpiStrip.innerHTML = stripHtml;
    
    document.getElementById("liveLastUpdated").innerText = `Last Updated: ${data.last_updated || new Date().toLocaleTimeString()}`;

    // Render a card for each member (Django style)
    data.meters.forEach(member => {
        const statusColor = member.status === 'OK' ? 'var(--dj-success)' : 'var(--dj-danger)';
        const kwhDisplay = member.kwh !== null ? member.kwh.toFixed(2) : '—';
        
        const cardHtml = `
            <div style="border: 1px solid var(--dj-border); border-radius: 4px; background: var(--dj-bg); color: var(--dj-text); overflow: hidden; height: 100%;">
                <div style="background: var(--dj-header-bg); color: var(--dj-header-text); padding: 8px 12px; font-size: 14px; font-weight: bold;">
                    ${member.meter_name} <span style="font-size: 11px; float: right; font-weight: normal; opacity: 0.8;">#${member.meter_id}</span>
                </div>
                <div style="padding: 15px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border); color: var(--dj-text-sub);">Status</td>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border); text-align: right; font-weight: bold; color: ${statusColor};">${member.status}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border); color: var(--dj-text-sub);">Total Energy</td>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border); text-align: right; font-weight: bold;">${kwhDisplay} kWh</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: var(--dj-text-sub);">Last Reading</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: bold;">${member.timestamp ? member.timestamp.split(" ")[1] : '—'}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
        
        const cardContainer = document.createElement("div");
        cardContainer.innerHTML = cardHtml;
        cardsContainer.appendChild(cardContainer.firstElementChild);
    });
}

async function loadHistoryData() {
    if (!groupId) return;
    try {
        const res = await fetch(`/api/group_energy_summary?group_id=${groupId}`);
        const data = await res.json();
        renderHistoryView(data);
    } catch (e) {
        console.error("Failed to load history data", e);
    }
}

function renderHistoryView(data) {
    historySummaryStrip.innerHTML = "";
    historyCardsContainer.innerHTML = "";

    if (!data || !data.members) {
        historyCardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>No history data available.</p></div>`;
        return;
    }

    const stripHtml = `
        <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Today's Consumption</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${(data.selected_total_kwh || 0).toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub);">kWh</span></div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Yesterday's Consumption</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${(data.yesterday_total_kwh || 0).toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub);">kWh</span></div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border); background: var(--dj-bg-sub); border-radius: 4px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--dj-text-sub); text-transform: uppercase;">Peak Power (Today)</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg);">${((data.selected_total_kwh || 0) / 24).toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub);">kW Avg</span></div>
            </div>
        </div>
    `;
    historySummaryStrip.innerHTML = stripHtml;
    
    // We can render bar charts for each member if we had historical data per member.
    // The group_energy_summary endpoint returns basic info. We can just list them.
    data.members.forEach(member => {
        const cardHtml = `
            <div style="border: 1px solid var(--dj-border); border-radius: 4px; background: var(--dj-bg); color: var(--dj-text); overflow: hidden; height: 100%;">
                <div style="background: var(--dj-header-bg); color: var(--dj-header-text); padding: 8px 12px; font-size: 14px; font-weight: bold;">
                    ${member.meter_name} <span style="background: var(--dj-header-bg-sub); padding: 2px 6px; border-radius: 2px; font-size: 11px; float: right; font-weight: normal; text-transform: uppercase;">${member.type}</span>
                </div>
                <div style="padding: 15px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr>
                            <td style="padding: 6px 0; color: var(--dj-text-sub);">Today's Consumption</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: bold;">${member.today_kwh.toFixed(2)} kWh</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
        
        const cardContainer = document.createElement("div");
        cardContainer.innerHTML = cardHtml;
        historyCardsContainer.appendChild(cardContainer.firstElementChild);
    });
}

function startLivePolling() {
    if (livePollingInterval) clearInterval(livePollingInterval);
    livePollingInterval = setInterval(() => {
        if (currentViewMode === "live") {
            loadLiveData();
        }
    }, 5000); // 5 seconds
}

function stopLivePolling() {
    if (livePollingInterval) clearInterval(livePollingInterval);
}

// Init
loadGroupMeta();
if (groupId) {
    setViewMode("live");
}
