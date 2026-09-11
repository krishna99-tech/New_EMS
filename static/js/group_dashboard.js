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
let currentChartType = 'bar';

window.toggleGroupChartType = function () {
    currentChartType = currentChartType === 'bar' ? 'line' : 'bar';
    if (lastHistorySummary) {
        renderHistoryCards(lastHistorySummary);
    }
};

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

            const locEl = document.getElementById("groupLocation");
            const locText = document.getElementById("groupLocationText");
            const subTitle = document.getElementById("groupSubtitle");

            if (locEl && locText) {
                locText.textContent = currentGroupMeta.location_name || 'Unassigned';
                locEl.style.display = "flex";
            }
            if (subTitle) subTitle.style.display = "none";
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

    const todayKwh = (data.today_consumption_kwh || 0).toFixed(2);
    const shiftKwh = (data.current_shift_consumption_kwh || 0).toFixed(2);
    const onlineCnt = data.online_count || 0;
    const totalCnt = data.member_count || 0;
    const offlineCnt = totalCnt - onlineCnt;

    liveKpiStrip.innerHTML = `
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon blue">⚡</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Today's Consumption</div>
                <div class="gdash-kpi-value">${todayKwh}</div>
                <div class="gdash-kpi-unit">kWh total</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon orange">🔄</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Shift Consumption</div>
                <div class="gdash-kpi-value">${shiftKwh}</div>
                <div class="gdash-kpi-unit">kWh this shift</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon green">✅</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Members Online</div>
                <div class="gdash-kpi-value">${onlineCnt}<span style="font-size:0.75rem; font-weight:500; color:var(--dj-text-sub); font-family:sans-serif;"> / ${totalCnt}</span></div>
                <div class="gdash-kpi-unit">${offlineCnt > 0 ? offlineCnt + ' offline' : 'all online'}</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon purple">📊</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Avg per Meter</div>
                <div class="gdash-kpi-value">${totalCnt > 0 ? (parseFloat(todayKwh) / totalCnt).toFixed(2) : '—'}</div>
                <div class="gdash-kpi-unit">kWh / meter</div>
            </div>
        </div>
    `;

    const lastUpdatedEl = document.getElementById("liveLastUpdated");
    if (lastUpdatedEl) {
        lastUpdatedEl.innerText = `🕐 Last updated: ${data.last_updated || new Date().toLocaleTimeString()}`;
    }

    // Render a premium card for each member meter
    data.meters.forEach(member => {
        const isOnline = member.status === 'OK';
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? '● Online' : '● Offline';
        const kwhDisplay = member.kwh !== null && member.kwh !== undefined ? Number(member.kwh).toFixed(2) : '—';
        const timeStr = member.timestamp ? (member.timestamp.split(" ")[1] || member.timestamp) : '—';
        const pulseDot = isOnline ? '<span class="gdash-pulse"></span>' : '';

        const card = document.createElement("div");
        card.className = "gdash-meter-card";
        card.innerHTML = `
            <div class="gdash-meter-card-head ${statusClass}">
                <span>${member.meter_name}</span>
                <span class="gdash-meter-id-badge">#${member.meter_id}</span>
            </div>
            <div class="gdash-meter-body">
                <div class="gdash-kwh-big">
                    <div class="gdash-kwh-num">${kwhDisplay}</div>
                    <div class="gdash-kwh-sub">kWh Register</div>
                </div>
                <div style="margin-top:10px;">
                    <div class="gdash-meter-row">
                        <span class="gdash-meter-row-label">Status</span>
                        <span class="gdash-meter-row-val" style="color:${isOnline ? 'var(--dj-success,#16a34a)' : 'var(--dj-danger,#dc2626);'}">${pulseDot}${statusText}</span>
                    </div>
                    <div class="gdash-meter-row">
                        <span class="gdash-meter-row-label">Last Reading</span>
                        <span class="gdash-meter-row-val">${timeStr}</span>
                    </div>
                    ${member.plant ? `<div class="gdash-meter-row"><span class="gdash-meter-row-label">Plant</span><span class="gdash-meter-row-val">${member.plant}</span></div>` : ''}
                </div>
            </div>
        `;
        cardsContainer.appendChild(card);
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

    const modeLabel = data.mode === "custom" ? "Custom Range" : (data.selected_shift === "all" ? "All Shifts" : data.selected_shift);

    historySummaryStrip.innerHTML = `
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon blue">⚡</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Total Consumption</div>
                <div class="gdash-kpi-value">${totalKwh.toFixed(2)}</div>
                <div class="gdash-kpi-unit">kWh for period</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon orange">📅</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Periods</div>
                <div class="gdash-kpi-value">${barCount || 1}</div>
                <div class="gdash-kpi-unit">${modeLabel}</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon green">📈</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Avg per Period</div>
                <div class="gdash-kpi-value">${avgKwh.toFixed(2)}</div>
                <div class="gdash-kpi-unit">kWh average</div>
            </div>
        </div>
        <div class="gdash-kpi-card">
            <div class="gdash-kpi-icon purple">🏆</div>
            <div class="gdash-kpi-body">
                <div class="gdash-kpi-label">Peak Period</div>
                <div class="gdash-kpi-value">${peakVal.toFixed(2)}</div>
                <div class="gdash-kpi-unit">${peakLabel}</div>
            </div>
        </div>
    `;
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
                <div style="display: flex; gap: 8px;">
                    <button onclick="downloadGraphPdf()" id="btnDownloadChart" style="background:var(--dj-bg-sub); border:1px solid var(--dj-border); border-radius:6px; padding:6px 10px; cursor:pointer; color:var(--dj-text); display:flex; align-items:center; gap:6px; font-size:0.8rem; font-weight:600; transition:all 0.2s;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download PDF
                    </button>
                    <button onclick="toggleGroupChartType()" style="background:var(--dj-bg-sub); border:1px solid var(--dj-border); border-radius:6px; padding:6px 10px; cursor:pointer; color:var(--dj-text); display:flex; align-items:center; gap:6px; font-size:0.8rem; font-weight:600; transition:all 0.2s;">
                        ${currentChartType === 'bar' ? '📈 Switch to Line' : '📊 Switch to Bar'}
                    </button>
                </div>
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

            // Save data globally for PDF generation
            const shiftEl = document.getElementById("shiftSelect");
            const selectedShift = shiftEl ? shiftEl.options[shiftEl.selectedIndex].text : "All Shifts";

            window.currentChartData = {
                labels: labels,
                datasetsData: datasetsData,
                from_dt: data.from_dt || "",
                to_dt: data.to_dt || "",
                shift: selectedShift,
                meters: (data.members || []).map(m => m.meter_name)
            };

            groupChartInstance = new Chart(ctx, {
                type: currentChartType,
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Consumption (kWh)',
                        data: datasetsData,
                        backgroundColor: currentChartType === 'line' ? 'rgba(79, 70, 229, 0.15)' : 'rgba(79, 70, 229, 0.75)',
                        borderColor: '#4f46e5',
                        borderWidth: currentChartType === 'line' ? 2.5 : 1.5,
                        borderRadius: currentChartType === 'bar' ? 4 : 0,
                        maxBarThickness: 45,
                        fill: currentChartType === 'line',
                        tension: 0.3,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#4f46e5',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        onComplete: function () {
                            const chartInstance = this;
                            const ctx = chartInstance.ctx;
                            ctx.font = 'bold 11px sans-serif';
                            ctx.fillStyle = '#4f46e5';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';

                            this.data.datasets.forEach(function (dataset, i) {
                                const meta = chartInstance.getDatasetMeta(i);
                                meta.data.forEach(function (element, index) {
                                    const data = dataset.data[index];
                                    if (data > 0) {
                                        ctx.fillText(data.toFixed(1), element.x, element.y - 6);
                                    }
                                });
                            });
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
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
            <div class="dashboard-empty-state" style="padding: 30px 20px; text-align: center; background: var(--dj-bg-sub); border: 1px dashed var(--dj-border); border-radius: 8px; margin: 16px 0;">
                <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 600;">No Member Energy Share Data</h4>
                <p style="margin: 0; font-size: 0.82rem; color: var(--dj-text-sub);">No energy consumption logged for individual meters in this window.</p>
            </div>
        `;
        return;
    }

    // Find max for progress bar scaling
    const maxKwh = Math.max(...members.map(m => parseFloat(m.kwh) || 0), 1);

    let memberRows = '';
    members.forEach(m => {
        const kwh = m.kwh !== null && m.kwh !== undefined ? Number(m.kwh).toFixed(2) : '0.00';
        const pct = m.pct !== null && m.pct !== undefined ? Number(m.pct).toFixed(1) : '0.0';
        const barPct = Math.min(100, ((parseFloat(m.kwh) || 0) / maxKwh * 100)).toFixed(1);
        const typeBadge = m.type === 'incomer'
            ? `<span style="background:rgba(234,88,12,0.12); color:#ea580c; padding:1px 7px; border-radius:4px; font-size:0.7rem; font-weight:700; text-transform:uppercase;">Incomer</span>`
            : `<span style="background:var(--dj-bg-sub); color:var(--dj-text-sub); padding:1px 7px; border-radius:4px; font-size:0.7rem; font-weight:700; text-transform:uppercase;">Sub</span>`;

        memberRows += `
            <tr class="admin-table-row">
                <td style="padding:12px 16px; font-weight:600; color:var(--dj-text);">${m.meter_name}</td>
                <td style="padding:12px 16px;">${typeBadge}</td>
                <td style="padding:12px 16px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="flex:1; height:6px; background:var(--dj-bg-sub); border-radius:3px; min-width:60px;">
                            <div style="height:100%; width:${barPct}%; background:var(--dj-header-bg,#417690); border-radius:3px; transition:width 0.6s ease;"></div>
                        </div>
                        <span style="font-family:monospace; font-weight:700; font-size:0.88rem; min-width:70px; text-align:right;">${kwh} kWh</span>
                    </div>
                </td>
                <td style="padding:12px 16px; text-align:right; font-family:monospace; font-weight:600; color:var(--dj-header-bg,#417690);">${pct}%</td>
            </tr>
        `;
    });

    memberBreakdownContainer.innerHTML = `
        <div class="gdash-history-table">
            <div class="gdash-history-table-head">
                <span class="gdash-history-table-title">📊 Meter Register &amp; Energy Share</span>
                <span style="font-size:0.78rem; color:var(--dj-text-sub);">${members.length} member meters</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
                    <thead>
                        <tr class="admin-table-header">
                            <th>Meter Name</th>
                            <th>Type</th>
                            <th>Consumption</th>
                            <th style="text-align:right;">Share</th>
                        </tr>
                    </thead>
                    <tbody>${memberRows}</tbody>
                </table>
            </div>
        </div>
    `;
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

async function downloadGraphPdf() {
    const btn = document.getElementById('btnDownloadChart');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span style="font-size:12px;">⏳ Generating...</span>`;
    btn.disabled = true;

    try {
        const canvas = document.getElementById('groupHistoryChart');
        if (!canvas) throw new Error("Chart canvas not found.");

        // Render chart against white background if it's transparent
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(canvas, 0, 0);

        const chartImage = tempCanvas.toDataURL('image/png');
        const groupName = document.getElementById("groupTitle").textContent.replace("Group: ", "").trim();
        const locEl = document.getElementById("groupLocationText");
        const locationName = locEl && locEl.textContent ? locEl.textContent.trim() : "Unassigned";

        // Prepare detailed data points
        const cData = window.currentChartData;
        const dataPoints = cData.labels.map((lbl, i) => ({
            label: lbl,
            value: cData.datasetsData[i]
        }));

        const payload = {
            group_name: groupName,
            location: locationName,
            shift: cData.shift,
            meters_included: cData.meters,
            start_date: cData.from_dt,
            end_date: cData.to_dt,
            chart_image: chartImage,
            data_points: dataPoints
        };

        const res = await fetch('/api/reports/download_group_chart_pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || `Server error ${res.status}`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;

        // Generate a timestamp for the filename
        const now = new Date();
        const timeStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + "_" +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');

        a.download = `${groupName}_Chart_Report_${timeStr}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (err) {
        console.error("PDF generation failed:", err);
        alert("Failed to generate PDF: " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
