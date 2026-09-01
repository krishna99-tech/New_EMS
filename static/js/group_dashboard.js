// group_dashboard.js — Meter Group Dashboard with Full Filtering, Custom Time & Bar Graphs

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
const memberBreakdownContainer = document.getElementById("memberBreakdownContainer");
const liveKpiStrip = document.getElementById("liveKpiStrip");
const historySummaryStrip = document.getElementById("historySummaryStrip");

// Filter bar elements
const shiftAnalysisToggle = document.getElementById("shiftAnalysisToggle");
const customTimeToggle = document.getElementById("customTimeToggle");
const barGraphToggle = document.getElementById("barGraphToggle");
const shiftSelect = document.getElementById("shiftSelect");
const fromDateTime = document.getElementById("fromDateTime");
const toDateTime = document.getElementById("toDateTime");
const submitFiltersBtn = document.getElementById("submitFiltersBtn");

let currentViewMode = "live";
let livePollingInterval = null;
let currentGroupMeta = null;
let groupChartInstance = null;
let lastHistorySummary = null;

// Initial state and event listeners
if (btnGroupLive) btnGroupLive.addEventListener("click", () => setViewMode("live"));
if (btnGroupHistory) btnGroupHistory.addEventListener("click", () => setViewMode("history"));

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

// Toggle Mutual Exclusivity and UI Input Type Sync
function syncShiftUiForGroup() {
    if (customTimeToggle && customTimeToggle.checked) {
        if (shiftSelect) shiftSelect.disabled = true;
        if (fromDateTime) fromDateTime.type = "datetime-local";
        if (toDateTime) toDateTime.type = "datetime-local";
    } else if (shiftAnalysisToggle && shiftAnalysisToggle.checked) {
        if (shiftSelect) shiftSelect.disabled = false;
        if (fromDateTime) fromDateTime.type = "date";
        if (toDateTime) toDateTime.type = "date";
    } else {
        if (shiftSelect) shiftSelect.disabled = false;
        if (fromDateTime) fromDateTime.type = "datetime-local";
        if (toDateTime) toDateTime.type = "datetime-local";
    }
}

// Default Date Range Initialization
function setDefaultDateRange() {
    if (!fromDateTime || !toDateTime) return;
    
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - tzOffset);
    let toStr = localNow.toISOString().slice(0, 16);

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000 - tzOffset);
    let fromStr = yesterday.toISOString().slice(0, 16);

    if (shiftAnalysisToggle && shiftAnalysisToggle.checked) {
        toStr = toStr.slice(0, 10);
        fromStr = fromStr.slice(0, 10);
    }
    
    if (!fromDateTime.value) fromDateTime.value = fromStr;
    if (!toDateTime.value) toDateTime.value = toStr;
}

// Filter Event Listeners
if (shiftAnalysisToggle) {
    shiftAnalysisToggle.addEventListener("change", () => {
        if (shiftAnalysisToggle.checked && customTimeToggle) customTimeToggle.checked = false;
        syncShiftUiForGroup();
        setDefaultDateRange();
        if (currentViewMode === "history") loadHistoryData();
    });
}

if (customTimeToggle) {
    customTimeToggle.addEventListener("change", () => {
        if (customTimeToggle.checked && shiftAnalysisToggle) shiftAnalysisToggle.checked = false;
        syncShiftUiForGroup();
        setDefaultDateRange();
        if (currentViewMode === "history") loadHistoryData();
    });
}

if (barGraphToggle) {
    barGraphToggle.addEventListener("change", () => {
        if (lastHistorySummary && currentViewMode === "history") {
            renderHistoryCards(lastHistorySummary);
        } else if (currentViewMode === "history") {
            loadHistoryData();
        }
    });
}

if (shiftSelect) {
    shiftSelect.addEventListener("change", () => {
        if (currentViewMode === "history") loadHistoryData();
    });
}

if (submitFiltersBtn) {
    submitFiltersBtn.addEventListener("click", () => {
        if (currentViewMode === "history") loadHistoryData();
    });
}

function setViewMode(mode) {
    currentViewMode = mode;
    const filterPanel = document.getElementById("groupHistoryFilterPanel");
    
    if (mode === "live") {
        if (btnGroupLive) btnGroupLive.classList.add("active");
        if (btnGroupHistory) btnGroupHistory.classList.remove("active");
        if (liveViewContainer) liveViewContainer.style.display = "block";
        if (historyViewContainer) historyViewContainer.style.display = "none";
        if (filterPanel) filterPanel.style.display = "none";
        loadLiveData();
        startLivePolling();
    } else {
        if (btnGroupLive) btnGroupLive.classList.remove("active");
        if (btnGroupHistory) btnGroupHistory.classList.add("active");
        if (liveViewContainer) liveViewContainer.style.display = "none";
        if (historyViewContainer) historyViewContainer.style.display = "block";
        if (filterPanel) filterPanel.style.display = "block";
        stopLivePolling();
        
        syncShiftUiForGroup();
        setDefaultDateRange();
        loadHistoryData();
    }
}

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
        if (currentGroupMeta && groupTitle) {
            groupTitle.textContent = `Group: ${currentGroupMeta.name}`;
        }
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
    if (!liveKpiStrip || !cardsContainer) return;
    liveKpiStrip.innerHTML = "";
    cardsContainer.innerHTML = "";
    
    if (!data || !data.meters) {
        cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>No live data available for this group.</p></div>`;
        return;
    }

    // Render KPI Strip for the group
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
    
    const lastUpdatedEl = document.getElementById("liveLastUpdated");
    if (lastUpdatedEl) {
        lastUpdatedEl.innerText = `Last Updated: ${data.last_updated || new Date().toLocaleTimeString()}`;
    }

    // Render a card for each member
    data.meters.forEach(member => {
        const statusColor = member.status === 'OK' ? 'var(--dj-success, #10b981)' : 'var(--dj-danger, #ef4444)';
        const kwhDisplay = member.kwh !== null && member.kwh !== undefined ? Number(member.kwh).toFixed(2) : '—';
        
        const cardHtml = `
            <div style="border: 1px solid var(--dj-border, #e5e7eb); border-radius: 6px; background: var(--dj-bg, #ffffff); color: var(--dj-text, #1f2937); overflow: hidden; height: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="background: var(--dj-header-bg, #4f46e5); color: #ffffff; padding: 10px 14px; font-size: 14px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                    <span>${member.meter_name}</span>
                    <span style="font-size: 11px; background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px; font-weight: normal;">#${member.meter_id}</span>
                </div>
                <div style="padding: 15px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border, #e5e7eb); color: var(--dj-text-sub, #6b7280);">Status</td>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border, #e5e7eb); text-align: right; font-weight: bold; color: ${statusColor};">${member.status}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border, #e5e7eb); color: var(--dj-text-sub, #6b7280);">Total Register</td>
                            <td style="padding: 6px 0; border-bottom: 1px solid var(--dj-border, #e5e7eb); text-align: right; font-weight: bold;">${kwhDisplay} kWh</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: var(--dj-text-sub, #6b7280);">Last Reading</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: bold;">${member.timestamp ? member.timestamp.split(" ")[1] || member.timestamp : '—'}</td>
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

function buildFilterParams() {
    const shift = shiftSelect ? shiftSelect.value : "all";
    let from_dt = fromDateTime ? fromDateTime.value : "";
    let to_dt = toDateTime ? toDateTime.value : "";
    
    if (shiftAnalysisToggle && shiftAnalysisToggle.checked) {
        if (from_dt.length === 10) from_dt += "T06:00";
        if (to_dt.length === 10) to_dt += "T06:00";
    }
    
    const mode = (customTimeToggle && customTimeToggle.checked) ? "custom" : "shiftwise";
    return { groupId, shift, from_dt, to_dt, mode };
}

async function loadHistoryData() {
    if (!groupId) return;
    
    const { groupId: gId, shift, from_dt, to_dt, mode } = buildFilterParams();
    if (!gId) return;

    if (historyCardsContainer) {
        historyCardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Loading historical data...</p></div>`;
    }

    try {
        let url = `/api/group_energy_summary?group_id=${gId}&mode=${mode}&shift=${encodeURIComponent(shift)}`;
        if (from_dt && to_dt) {
            url += `&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}`;
        }
        
        const res = await fetch(url);
        if (!res.ok) {
            if (historyCardsContainer) {
                historyCardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Failed to load group summary.</p></div>`;
            }
            return;
        }
        
        const data = await res.json();
        lastHistorySummary = data;
        
        renderHistorySummary(data);
        renderHistoryCards(data);
        renderMemberBreakdown(data);
    } catch (e) {
        console.error("Failed to load history data", e);
        if (historyCardsContainer) {
            historyCardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Error loading history data.</p></div>`;
        }
    }
}

function renderHistorySummary(data) {
    if (!historySummaryStrip) return;
    historySummaryStrip.innerHTML = "";

    const totalKwh = data.selected_total_kwh || 0;
    const bars = data.bars || [];
    const barCount = bars.length;
    const avgKwh = barCount > 0 ? (totalKwh / barCount) : totalKwh;

    let peakLabel = "—";
    let peakVal = 0;
    if (bars.length > 0) {
        const peak = bars.reduce((max, b) => (b.consumption > max.consumption ? b : max), bars[0]);
        peakLabel = peak.label || peak.shift_name || "Peak";
        peakVal = peak.consumption || 0;
    } else {
        peakVal = totalKwh;
    }

    const modeLabel = data.mode === "custom" ? "Custom Time" : (data.selected_shift === "all" ? "All Shifts" : data.selected_shift);

    const stripHtml = `
        <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border, #e5e7eb); background: var(--dj-bg-sub, #f9fafb); border-radius: 6px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px; color: var(--dj-text-sub, #6b7280); text-transform: uppercase; letter-spacing: 0.05em;">Total Consumption</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg, #4f46e5);">${totalKwh.toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub, #6b7280);">kWh</span></div>
                <div style="font-size:11px; color:var(--dj-text-sub, #6b7280); margin-top:4px;">Period Total</div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border, #e5e7eb); background: var(--dj-bg-sub, #f9fafb); border-radius: 6px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px; color: var(--dj-text-sub, #6b7280); text-transform: uppercase; letter-spacing: 0.05em;">Periods / Filter</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg, #4f46e5);">${barCount || 1} <span style="font-size:14px; color:var(--dj-text-sub, #6b7280);">${barCount === 1 ? 'bucket' : 'buckets'}</span></div>
                <div style="font-size:11px; color:var(--dj-text-sub, #6b7280); margin-top:4px;">${modeLabel}</div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border, #e5e7eb); background: var(--dj-bg-sub, #f9fafb); border-radius: 6px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px; color: var(--dj-text-sub, #6b7280); text-transform: uppercase; letter-spacing: 0.05em;">Avg per Period</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg, #4f46e5);">${avgKwh.toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub, #6b7280);">kWh</span></div>
                <div style="font-size:11px; color:var(--dj-text-sub, #6b7280); margin-top:4px;">Average Consumption</div>
            </div>
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--dj-border, #e5e7eb); background: var(--dj-bg-sub, #f9fafb); border-radius: 6px; padding: 15px; text-align: center;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px; color: var(--dj-text-sub, #6b7280); text-transform: uppercase; letter-spacing: 0.05em;">Peak Period</h4>
                <div style="font-size: 24px; font-weight: bold; color: var(--dj-header-bg, #4f46e5);">${peakVal.toFixed(2)} <span style="font-size:14px; color:var(--dj-text-sub, #6b7280);">kWh</span></div>
                <div style="font-size:11px; color:var(--dj-text-sub, #6b7280); margin-top:4px;">${peakLabel}</div>
            </div>
        </div>
    `;
    historySummaryStrip.innerHTML = stripHtml;
}

function renderHistoryCards(data) {
    if (!historyCardsContainer) return;
    historyCardsContainer.innerHTML = "";

    const showBarGraph = barGraphToggle && barGraphToggle.checked;
    const bars = data.bars || [];
    const hasData = (bars.length > 0) || (data.selected_total_kwh > 0) || (data.has_shift_window_data === true);

    if (!hasData) {
        historyCardsContainer.innerHTML = `
            <div class="dashboard-empty-state" style="padding: 40px 20px; text-align: center; background: var(--dj-bg-sub, #f9fafb); border: 1px dashed var(--dj-border, #cccccc); border-radius: 8px; margin: 16px 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; color: var(--dj-text-sub, #6b7280); opacity: 0.7;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h4 style="margin: 0 0 6px 0; font-size: 1.05rem; font-weight: 600; color: var(--dj-text, #333333);">No Data Available</h4>
                <p style="margin: 0; font-size: 0.88rem; color: var(--dj-text-sub, #666666); max-width: 420px; margin: 0 auto;">No energy meter readings were recorded for the selected date and time range.</p>
            </div>
        `;
        return;
    }

    if (showBarGraph) {
        // Render Bar Graph Chart (using Chart.js or styled CSS bars)
        const chartWrapper = document.createElement("div");
        chartWrapper.style.cssText = "border: 1px solid var(--dj-border, #e5e7eb); border-radius: 8px; background: var(--dj-bg, #ffffff); padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 20px;";
        chartWrapper.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 1.1rem; color: var(--dj-header-bg, #1f2937); font-weight: 600;">Aggregated Energy Consumption (kWh)</h3>
                <span style="font-size: 0.8rem; color: var(--dj-text-sub, #6b7280); font-weight: 500;">Bar Chart View</span>
            </div>
            <div style="position: relative; height: 320px; width: 100%;">
                <canvas id="groupHistoryChart"></canvas>
            </div>
        `;
        historyCardsContainer.appendChild(chartWrapper);

        // Chart.js Rendering
        if (typeof Chart !== "undefined") {
            const ctx = document.getElementById("groupHistoryChart").getContext("2d");
            if (groupChartInstance) groupChartInstance.destroy();

            let labels = [];
            let datasetsData = [];

            if (data.mode === "custom" && bars.length === 0) {
                labels = [`${data.from_dt} to ${data.to_dt}`];
                datasetsData = [data.selected_total_kwh || 0];
            } else {
                labels = bars.map(b => b.label);
                datasetsData = bars.map(b => b.consumption);
            }

            groupChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Consumption (kWh)',
                        data: datasetsData,
                        backgroundColor: 'rgba(79, 70, 229, 0.75)',
                        borderColor: '#4f46e5',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        maxBarThickness: 45
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `Consumption: ${context.parsed.y.toFixed(2)} kWh`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'kWh', color: '#6b7280', font: { size: 12 } },
                            grid: { color: 'rgba(229, 231, 235, 0.6)' }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });
        }
    } else {
        // Render Tabular Data View
        let tableRows = '';
        if (bars.length > 0) {
            bars.forEach(b => {
                tableRows += `
                    <tr style="border-bottom: 1px solid var(--dj-border, #e5e7eb);">
                        <td style="padding: 12px 16px; font-weight: 500;">${b.label}</td>
                        <td style="padding: 12px 16px; color: var(--dj-text-sub, #6b7280);">${b.shift_name || '—'}</td>
                        <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${(b.start_kwh || 0).toFixed(2)}</td>
                        <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${(b.end_kwh || 0).toFixed(2)}</td>
                        <td style="padding: 12px 16px; text-align: right; font-weight: bold; color: var(--dj-header-bg, #4f46e5); font-family: monospace;">${(b.consumption || 0).toFixed(2)} kWh</td>
                    </tr>
                `;
            });
        } else {
            tableRows = `
                <tr style="border-bottom: 1px solid var(--dj-border, #e5e7eb);">
                    <td style="padding: 12px 16px; font-weight: 500;">${data.from_dt} to ${data.to_dt}</td>
                    <td style="padding: 12px 16px; color: var(--dj-text-sub, #6b7280);">Custom Range</td>
                    <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${(data.range_start_kwh || 0).toFixed(2)}</td>
                    <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${(data.range_end_kwh || 0).toFixed(2)}</td>
                    <td style="padding: 12px 16px; text-align: right; font-weight: bold; color: var(--dj-header-bg, #4f46e5); font-family: monospace;">${(data.selected_total_kwh || 0).toFixed(2)} kWh</td>
                </tr>
            `;
        }

        const tableHtml = `
            <div style="border: 1px solid var(--dj-border, #e5e7eb); border-radius: 8px; background: var(--dj-bg, #ffffff); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="padding: 16px 20px; background: var(--dj-bg-sub, #f9fafb); border-bottom: 1px solid var(--dj-border, #e5e7eb);">
                    <h3 style="margin: 0; font-size: 1rem; color: var(--dj-header-bg, #1f2937); font-weight: 600;">Aggregated Energy Consumption Breakdown</h3>
                </div>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: var(--dj-bg-sub, #f9fafb); text-align: left; color: var(--dj-text-sub, #6b7280); font-weight: 600;">
                                <th style="padding: 12px 16px; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Period / Label</th>
                                <th style="padding: 12px 16px; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Shift</th>
                                <th style="padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Start (kWh)</th>
                                <th style="padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--dj-border, #e5e7eb);">End (kWh)</th>
                                <th style="padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Consumption</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        historyCardsContainer.innerHTML = tableHtml;
    }
}

function renderMemberBreakdown(data) {
    if (!memberBreakdownContainer) return;
    memberBreakdownContainer.innerHTML = "";

    const members = data.members || [];
    const hasMemberData = members.length > 0 && members.some(m => m.kwh && m.kwh > 0);

    if (!hasMemberData) {
        memberBreakdownContainer.innerHTML = `
            <div class="dashboard-empty-state" style="padding: 30px 20px; text-align: center; background: var(--dj-bg-sub, #f9fafb); border: 1px dashed var(--dj-border, #cccccc); border-radius: 8px; margin: 16px 0;">
                <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 600; color: var(--dj-text, #333333);">No Member Energy Share Data</h4>
                <p style="margin: 0; font-size: 0.82rem; color: var(--dj-text-sub, #666666);">No energy consumption logged for individual meters in this window.</p>
            </div>
        `;
        return;
    }

    let memberRows = '';
    members.forEach(m => {
        const kwh = m.kwh !== null && m.kwh !== undefined ? Number(m.kwh).toFixed(2) : '0.00';
        const pct = m.pct !== null && m.pct !== undefined ? Number(m.pct).toFixed(1) : '0.0';

        memberRows += `
            <tr style="border-bottom: 1px solid var(--dj-border, #e5e7eb);">
                <td style="padding: 12px 16px; font-weight: 500;">${m.meter_name}</td>
                <td style="padding: 12px 16px; color: var(--dj-text-sub, #6b7280);">
                    <span style="background: var(--dj-bg-sub, #eef2ff); color: var(--dj-header-bg, #4f46e5); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: 600;">${m.type || 'meter'}</span>
                </td>
                <td style="padding: 12px 16px; text-align: right; font-weight: bold; font-family: monospace;">${kwh} kWh</td>
                <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${pct}%</td>
            </tr>
        `;
    });

    const breakdownHtml = `
        <div style="border: 1px solid var(--dj-border, #e5e7eb); border-radius: 8px; background: var(--dj-bg, #ffffff); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="padding: 16px 20px; background: var(--dj-bg-sub, #f9fafb); border-bottom: 1px solid var(--dj-border, #e5e7eb); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 1rem; color: var(--dj-header-bg, #1f2937); font-weight: 600;">Meter Register & Energy Share</h3>
                <span style="font-size: 0.8rem; color: var(--dj-text-sub, #6b7280);">${members.length} Member Meters</span>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: var(--dj-bg-sub, #f9fafb); text-align: left; color: var(--dj-text-sub, #6b7280); font-weight: 600;">
                            <th style="padding: 12px 16px; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Meter Name</th>
                            <th style="padding: 12px 16px; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Type</th>
                            <th style="padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Consumption (kWh)</th>
                            <th style="padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--dj-border, #e5e7eb);">Share (%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${memberRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    memberBreakdownContainer.innerHTML = breakdownHtml;
}

function startLivePolling() {
    if (livePollingInterval) clearInterval(livePollingInterval);
    livePollingInterval = setInterval(() => {
        if (currentViewMode === "live") {
            loadLiveData();
        }
    }, 5000);
}

function stopLivePolling() {
    if (livePollingInterval) clearInterval(livePollingInterval);
}

// Initialization
loadGroupMeta();
if (groupId) {
    setViewMode("live");
}
