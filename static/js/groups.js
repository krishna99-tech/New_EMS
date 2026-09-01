
let globalMeterGroupsDashboard = [];
let loadDataReqSeq = 0;
let lastHistorySummary = null;

const groupSelect = document.getElementById("groupSelect");
const dashboardTitle = document.getElementById("dashboardTitle");
const cardsContainer = document.getElementById("cardsContainer");
const shiftSelect = document.getElementById("shiftSelect");
const fromDateTime = document.getElementById("fromDateTime");
const toDateTime = document.getElementById("toDateTime");
const shiftAnalysisToggle = document.getElementById("shiftAnalysisToggle");
const customTimeToggle = document.getElementById("customTimeToggle");
const barGraphToggle = document.getElementById("barGraphToggle");
const submitFiltersBtn = document.getElementById("submitFiltersBtn");
const exportGroupCsvBtn = document.getElementById("exportGroupCsvBtn");
const exportGroupPdfBtn = document.getElementById("exportGroupPdfBtn");
const floatingHomeBtn = document.getElementById("floatingHomeBtn");
const liveStatus = document.getElementById("liveStatus");

function formatKwh(value, decimals = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return Number(value).toFixed(decimals);
}

function setDefaultDateRange() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - tzOffset);
    let toStr = localNow.toISOString().slice(0, 16);

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000 - tzOffset);
    let fromStr = yesterday.toISOString().slice(0, 16);

    if (shiftAnalysisToggle.checked) {
        toStr = toStr.slice(0, 10);
        fromStr = fromStr.slice(0, 10);
    }
    fromDateTime.value = fromStr;
    toDateTime.value = toStr;
}

function syncShiftUiForGroup() {
    if (customTimeToggle.checked) {
        shiftSelect.disabled = true;
        fromDateTime.type = "datetime-local";
        toDateTime.type = "datetime-local";
    } else if (shiftAnalysisToggle.checked) {
        shiftSelect.disabled = false;
        fromDateTime.type = "date";
        toDateTime.type = "date";
    } else {
        shiftSelect.disabled = false;
        fromDateTime.type = "datetime-local";
        toDateTime.type = "datetime-local";
    }
}

async function loadMeterGroupsForDashboard() {
    try {
        const res = await fetch("/api/meter_groups");
        if (res.ok) {
            globalMeterGroupsDashboard = await res.json();
            groupSelect.innerHTML = "<option value=\"\">Select Group</option>";
            globalMeterGroupsDashboard.forEach(g => {
                const opt = document.createElement("option");
                opt.value = g.id;
                opt.textContent = g.name;
                groupSelect.appendChild(opt);
            });
            renderCompareChecks();
        }
    } catch (e) {
        console.error("Failed to load meter groups", e);
    }
}

function getTableHTML(title, dataPoints, isEnergySummary = false, isCustomRange = false) {
    let html = `<div class="card premium-card"><div class="card-header"><div class="card-title">${title}</div></div><div class="card-content" style="padding:0;"><table class="shift-table" style="width:100%; border-collapse:collapse; margin:0; font-size:0.9rem;">`;
    if (isEnergySummary && isCustomRange) {
        html += `<thead><tr><th style="padding:12px 16px; text-align:left; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Time Range</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Start (kWh)</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">End (kWh)</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Total (kWh)</th></tr></thead><tbody>`;
        dataPoints.forEach(pt => {
            html += `<tr style="border-bottom:1px solid var(--border-color);"><td style="padding:12px 16px; color:var(--text-main); font-weight:500;">${pt.label}</td><td style="padding:12px 16px; text-align:right; color:var(--text-sub); font-family:var(--font-mono);">${formatKwh(pt.start_kwh)}</td><td style="padding:12px 16px; text-align:right; color:var(--text-sub); font-family:var(--font-mono);">${formatKwh(pt.end_kwh)}</td><td style="padding:12px 16px; text-align:right; color:var(--accent); font-weight:600; font-family:var(--font-mono);">${formatKwh(pt.value)}</td></tr>`;
        });
    } else if (isEnergySummary) {
        html += `<thead><tr><th style="padding:12px 16px; text-align:left; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Shift/Time</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Start (kWh)</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">End (kWh)</th><th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Total (kWh)</th></tr></thead><tbody>`;
        dataPoints.forEach(pt => {
            html += `<tr style="border-bottom:1px solid var(--border-color);"><td style="padding:12px 16px; color:var(--text-main); font-weight:500;">${pt.label}</td><td style="padding:12px 16px; text-align:right; color:var(--text-sub); font-family:var(--font-mono);">${formatKwh(pt.start_kwh)}</td><td style="padding:12px 16px; text-align:right; color:var(--text-sub); font-family:var(--font-mono);">${formatKwh(pt.end_kwh)}</td><td style="padding:12px 16px; text-align:right; color:var(--accent); font-weight:600; font-family:var(--font-mono);">${formatKwh(pt.value)}</td></tr>`;
        });
    }
    html += `</tbody></table></div></div>`;
    return html;
}

function getMemberTableHTML(members) {
    if (!members || members.length === 0) return "";
    let h = `
    <div class="meter-section">
        <h3 class="meter-section-title" style="margin-bottom: 16px;">Register Share (kWh)</h3>
        <div class="card premium-card" style="width: 100%;">
            <div class="card-content" style="padding:0; overflow-x:auto;">
                <table class="shift-table" style="width:100%; border-collapse:collapse; margin:0; font-size:0.9rem;">
                    <thead>
                        <tr>
                            <th style="padding:12px 16px; text-align:left; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Meter Name</th>
                            <th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Energy (kWh)</th>
                            <th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Share (%)</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    members.forEach(m => {
        h += `
            <tr style="border-bottom:1px solid var(--border-color); transition: background-color 0.2s;">
                <td style="padding:12px 16px; color:var(--text-main); font-weight:500;">${m.meter_name}</td>
                <td style="padding:12px 16px; text-align:right; color:var(--accent); font-weight:700; font-family:var(--font-mono);">${formatKwh(m.kwh, 2)}</td>
                <td style="padding:12px 16px; text-align:right; color:var(--text-main); font-family:var(--font-mono);">${m.pct}%</td>
            </tr>
        `;
    });
    
    h += `
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
    return h;
}

function getBarChartHTML(title, dataPoints) {
    let maxValue = 0;
    dataPoints.forEach(pt => { if (pt.value > maxValue) maxValue = pt.value; });
    if (maxValue === 0) maxValue = 1;

    let html = `<div class="card premium-card"><div class="card-header"><div class="card-title">${title}</div></div><div class="card-content bar-chart-container" style="display:flex; align-items:flex-end; gap:8px; height:220px; padding:20px 10px 30px; position:relative;">`;
    dataPoints.forEach((pt, i) => {
        const heightPct = Math.max(2, (pt.value / maxValue) * 100);
        const delay = i * 0.05;
        html += `<div class="bar-wrapper" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; position:relative;">
            <div class="bar-value-label" style="font-size:0.75rem; color:var(--text-sub); margin-bottom:4px; font-family:var(--font-mono);">${formatKwh(pt.value)}</div>
            <div class="bar" style="width:100%; max-width:40px; background:var(--accent); border-radius:4px 4px 0 0; height:0; transition:height 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);" data-height="${heightPct}%"></div>
            <div class="bar-label" style="font-size:0.7rem; color:var(--text-sub); margin-top:8px; text-align:center; white-space:nowrap; position:absolute; bottom:-25px;">${pt.label.split(" ")[0]}</div>
        </div>`;
    });
    html += `</div></div>`;
    return html;
}

function animateBars() {
    setTimeout(() => {
        document.querySelectorAll(".bar").forEach(bar => {
            bar.style.height = bar.getAttribute("data-height");
        });
    }, 50);
}

function renderHistorySummary(summary) {
    const strip = document.getElementById("historySummaryStrip");
    const total = summary.selected_total_kwh;
    const barCount = (summary.bars || []).length;
    const avgPerBucket = barCount > 0 && total != null ? (total / barCount).toFixed(1) : "—";
    let peakLabel = "—";
    let peakVal = "—";
    if (summary.bars && summary.bars.length > 0) {
        const peak = summary.bars.reduce((a, b) => (b.consumption > a.consumption ? b : a));
        peakLabel = peak.label;
        peakVal = formatKwh(peak.consumption);
    }

    strip.innerHTML = `
        <div class="card premium-card kpi-card"><label>Total Consumption</label><div class="kpi-value">${formatKwh(total)}</div><span class="kpi-unit">kWh</span></div>
        <div class="card premium-card kpi-card"><label>Periods</label><div class="kpi-value">${barCount || "—"}</div><span class="kpi-unit">${summary.mode === "custom" ? "custom range" : "shifts/days"}</span></div>
        <div class="card premium-card kpi-card"><label>Avg per Period</label><div class="kpi-value">${avgPerBucket}</div><span class="kpi-unit">kWh</span></div>
        <div class="card premium-card kpi-card"><label>Peak Period</label><div class="kpi-value">${peakVal}</div><span class="kpi-unit">${peakLabel}</span></div>
    `;
}

function renderEnergySummaryCard(summary) {
    cardsContainer.innerHTML = "";
    document.getElementById("memberBreakdownContainer").innerHTML = "";
    lastHistorySummary = summary;
    renderHistorySummary(summary);

    const meterDiv = document.createElement("div");
    meterDiv.className = "meter-section";
    const groupName = dashboardTitle.innerText.replace("Group: ", "");
    meterDiv.innerHTML = `<h3 class="meter-section-title">${groupName} — Aggregated kWh</h3>`;

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
            }];
        }
    } else if (summary.bars && summary.bars.length > 0) {
        dataPoints = summary.bars.map(b => ({
            label: b.label,
            value: b.consumption,
            start_kwh: b.start_kwh,
            end_kwh: b.end_kwh,
        }));
    }

    if (dataPoints.length === 0 || (summary.selected_total_kwh === 0 && (!summary.bars || summary.bars.length === 0))) {
        cardsContainer.innerHTML = `
            <div class="dashboard-empty-state" style="padding: 40px 20px; text-align: center; background: var(--card-bg); border: 1px dashed var(--border-color); border-radius: 12px; margin: 16px 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; color: var(--text-sub); opacity: 0.7;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <h4 style="margin: 0 0 6px 0; font-size: 1.05rem; font-weight: 600; color: var(--text-main);">No Data Available</h4>
                <p style="margin: 0; font-size: 0.88rem; color: var(--text-sub); max-width: 420px; margin: 0 auto;">No energy meter readings were recorded for the selected date and time range.</p>
            </div>
        `;
        return;
    }

    if (barGraphToggle.checked) {
        cardGrid.insertAdjacentHTML("beforeend", getBarChartHTML("Aggregated Energy Consumption (kWh)", dataPoints));
    } else {
        cardGrid.insertAdjacentHTML("beforeend", getTableHTML("Aggregated Energy Consumption (kWh)", dataPoints, true, summary.mode === "custom"));
    }

    meterDiv.appendChild(cardGrid);
    cardsContainer.appendChild(meterDiv);

    if (summary.members && summary.members.length > 0) {
        document.getElementById("memberBreakdownContainer").innerHTML = getMemberTableHTML(summary.members);
    }

    if (barGraphToggle.checked) animateBars();
}

function buildFilterParams() {
    const groupId = groupSelect.value;
    const shift = shiftSelect.value;
    let from_dt = fromDateTime.value;
    let to_dt = toDateTime.value;
    if (shiftAnalysisToggle.checked) {
        if (from_dt.length === 10) from_dt += "T06:00";
        if (to_dt.length === 10) to_dt += "T06:00";
    }
    const mode = customTimeToggle.checked ? "custom" : "shiftwise";
    return { groupId, shift, from_dt, to_dt, mode };
}

async function loadData() {
    const reqId = ++loadDataReqSeq;
    if (shiftSelect.disabled && !customTimeToggle.checked) return;

    const { groupId, shift, from_dt, to_dt, mode } = buildFilterParams();

    if (!groupId || !shift) {
        cardsContainer.innerHTML = "";
        document.getElementById("historySummaryStrip").innerHTML = "";
        document.getElementById("memberBreakdownContainer").innerHTML = "";
        return;
    }
    if (!from_dt || !to_dt) {
        cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Please select both From and To, then click Submit.</p></div>`;
        return;
    }

    cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Loading data...</p></div>`;

    try {
        const res = await fetch(`/api/group_energy_summary?group_id=${groupId}&mode=${mode}&shift=${encodeURIComponent(shift)}&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}`);
        if (!res.ok) {
            cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Failed to load group summary.</p></div>`;
            return;
        }
        const summary = await res.json();
        if (reqId !== loadDataReqSeq) return;
        renderEnergySummaryCard(summary);
    } catch (e) {
        cardsContainer.innerHTML = `<div class="dashboard-empty-state"><p>Error fetching data.</p></div>`;
    }
}

function exportGroupCsv() {
    const { groupId, shift, from_dt, to_dt, mode } = buildFilterParams();
    if (!groupId || !from_dt || !to_dt) return;
    const url = `/export_group_csv?group_id=${groupId}&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}&mode=${mode}&shift=${encodeURIComponent(shift)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function exportGroupPdf() {
    const { groupId, from_dt, to_dt } = buildFilterParams();
    if (!groupId || !from_dt || !to_dt) return;
    const url = `/export_group_pdf?group_id=${groupId}&from_dt=${encodeURIComponent(from_dt)}&to_dt=${encodeURIComponent(to_dt)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function getSelectedCompareGroupIds() {
    return [...document.querySelectorAll(".compare-check input:checked")].map(cb => cb.value);
}

function renderCompareChecks() {
    const container = document.getElementById("compareGroupChecks");
    if (!container) return;
    if (!globalMeterGroupsDashboard.length) {
        container.innerHTML = `<span class="inline-note">No groups yet. Create groups in Admin → Meter Groups.</span>`;
        return;
    }
    container.innerHTML = globalMeterGroupsDashboard.map(g => `
        <label class="compare-check">
            <input type="checkbox" value="${g.id}" />
            <span>${g.name} (${g.members?.length || 0})</span>
        </label>
    `).join("");
}

function renderCompareTable(groups, columns) {
    const el = document.getElementById("compareResults");
    if (!groups.length) {
        el.innerHTML = `<p class="inline-note">No data to compare.</p>`;
        return;
    }
    let html = `<table class="compare-table"><thead><tr>`;
    columns.forEach(c => { html += `<th>${c.label}</th>`; });
    html += `</tr></thead><tbody>`;
    groups.forEach(g => {
        html += `<tr>`;
        columns.forEach(c => {
            const val = c.format ? c.format(g) : (g[c.key] ?? "—");
            html += `<td class="${c.numeric ? "num" : ""}">${val}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    el.innerHTML = html;
}

async function compareGroupsLive() {
    const ids = getSelectedCompareGroupIds();
    if (ids.length < 2) {
        alert("Select at least 2 groups to compare.");
        return;
    }
    const res = await fetch(`/api/groups/compare_live?group_ids=${ids.join(",")}`);
    if (!res.ok) {
        document.getElementById("compareResults").innerHTML = `<p class="inline-note">Compare failed.</p>`;
        return;
    }
    const data = await res.json();
    renderCompareTable(data.groups, [
        { label: "Group", key: "name" },
        { label: "Meters", key: "member_count", numeric: true },
        { label: "Online", key: "online_count", numeric: true },
        { label: "Current Shift kWh", key: "current_shift_kwh", numeric: true, format: g => formatKwh(g.current_shift_kwh) },
        { label: "Today kWh", key: "today_kwh", numeric: true, format: g => formatKwh(g.today_kwh) },
        { label: "Yesterday kWh", key: "yesterday_kwh", numeric: true, format: g => formatKwh(g.yesterday_kwh) },
        { label: "vs Yesterday", key: "today_vs_yesterday_pct", format: g => g.today_vs_yesterday_pct != null ? `${g.today_vs_yesterday_pct}%` : "—" },
    ]);
}

async function compareGroupsPeriod() {
    const ids = getSelectedCompareGroupIds();
    const fromDt = document.getElementById("compareFromDt")?.value;
    const toDt = document.getElementById("compareToDt")?.value;
    if (ids.length < 2) {
        alert("Select at least 2 groups to compare.");
        return;
    }
    if (!fromDt || !toDt) {
        alert("Select From and To dates for period comparison.");
        return;
    }
    const res = await fetch(`/api/groups/compare?group_ids=${ids.join(",")}&from_dt=${encodeURIComponent(fromDt)}&to_dt=${encodeURIComponent(toDt)}`);
    if (!res.ok) {
        document.getElementById("compareResults").innerHTML = `<p class="inline-note">Compare failed.</p>`;
        return;
    }
    const data = await res.json();
    renderCompareTable(data.groups, [
        { label: "Group", key: "name" },
        { label: "Meters", key: "member_count", numeric: true },
        { label: "With Data", key: "meters_with_data", numeric: true },
        { label: "Total kWh", key: "total_kwh", numeric: true, format: g => formatKwh(g.total_kwh) },
        { label: "Period", format: () => `${data.from_dt} → ${data.to_dt}` },
    ]);
}

function setDefaultCompareRange() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - tzOffset);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000 - tzOffset);
    const fromEl = document.getElementById("compareFromDt");
    const toEl = document.getElementById("compareToDt");
    if (fromEl) fromEl.value = yesterday.toISOString().slice(0, 16);
    if (toEl) toEl.value = localNow.toISOString().slice(0, 16);
}

let liveGroupInterval = null;

function renderLiveKpis(data) {
    const delta = data.today_vs_yesterday_pct;
    let deltaHtml = "";
    if (delta !== null && delta !== undefined) {
        const cls = delta >= 0 ? "kpi-delta-up" : "kpi-delta-down";
        const sign = delta >= 0 ? "+" : "";
        deltaHtml = `<span class="kpi-delta ${cls}">${sign}${delta}% vs yesterday</span>`;
    }

    document.getElementById("liveKpiStrip").innerHTML = `
        <div class="card premium-card kpi-card">
            <label>Current Shift</label>
            <div class="kpi-value">${formatKwh(data.current_shift_consumption_kwh)}</div>
            <span class="kpi-unit">kWh consumed</span>
        </div>
        <div class="card premium-card kpi-card">
            <label>Today (prod. day)</label>
            <div class="kpi-value">${formatKwh(data.today_consumption_kwh)}</div>
            ${deltaHtml}
        </div>
        <div class="card premium-card kpi-card">
            <label>Yesterday</label>
            <div class="kpi-value">${formatKwh(data.yesterday_consumption_kwh)}</div>
            <span class="kpi-unit">kWh consumed</span>
        </div>
        <div class="card premium-card kpi-card">
            <label>Register Total</label>
            <div class="kpi-value">${formatKwh(data.register_total_kwh, 2)}</div>
            <span class="kpi-hint">Sum of meter counters (not consumption)</span>
        </div>
    `;

    const lastEl = document.getElementById("liveLastUpdated");
    if (data.last_updated) {
        lastEl.textContent = `Last reading: ${data.last_updated} · ${data.online_count}/${data.member_count} meters online`;
    } else {
        lastEl.textContent = "No meter readings available for this group.";
    }
}

function renderPieChart(meters, registerTotal) {
    const pieContainer = document.getElementById("pieChartContainer");
    const withData = meters.filter(m => m.kwh !== null && m.kwh !== undefined);
    if (withData.length === 0) {
        pieContainer.innerHTML = `<div class="card premium-card"><div class="card-header"><div class="card-title">Register Share</div></div><div class="card-content"><p style="color:var(--text-sub);">No meter data available.</p></div></div>`;
        return;
    }

    let total = registerTotal > 0 ? registerTotal : withData.reduce((s, m) => s + (m.kwh || 0), 0);
    if (total === 0) total = 1;

    const colors = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#0ea5e9"];
    let gradientStops = [];
    let currentPct = 0;
    let legendHtml = `<div style="margin-top: 24px; display:flex; flex-direction:column; gap:8px;">`;

    withData.forEach((m, idx) => {
        const mKwh = parseFloat(m.kwh || 0);
        const pct = (mKwh / total) * 100;
        const color = colors[idx % colors.length];
        gradientStops.push(`${color} ${currentPct}% ${currentPct + pct}%`);
        currentPct += pct;
        legendHtml += `<div style="display:flex; align-items:center; justify-content:space-between; font-size:0.85rem;"><div style="display:flex; align-items:center; gap:8px;"><div style="width:12px; height:12px; background:${color}; border-radius:3px;"></div><span style="color:var(--text-main); font-weight:500;">${m.meter_name}</span></div><span style="color:var(--text-sub); font-family:var(--font-mono);">${formatKwh(mKwh, 2)} kWh (${pct.toFixed(1)}%)</span></div>`;
    });
    legendHtml += `</div>`;

    pieContainer.innerHTML = `
        <div class="card premium-card" style="height: 100%;">
            <div class="card-header"><div class="card-title">Register Share (kWh)</div></div>
            <div class="card-content" style="display:flex; flex-direction:column; align-items:center; padding-bottom:32px;">
                <div style="width: 180px; height: 180px; border-radius: 50%; background: conic-gradient(${gradientStops.join(", ")}); box-shadow: 0 10px 25px rgba(0,0,0,0.1); margin-top: 16px;"></div>
                <div style="width: 100%;">${legendHtml}</div>
            </div>
        </div>
    `;
}

function renderMeterCards(meters, registerTotal) {
    const indContainer = document.getElementById("individualMetersContainer");
    if (!meters || meters.length === 0) {
        indContainer.innerHTML = `<div class="dashboard-empty-state"><p>No meters in this group.</p></div>`;
        return;
    }

    const total = registerTotal > 0 ? registerTotal : meters.reduce((s, m) => s + (m.kwh || 0), 0);
    
    let html = `
        <div class="card premium-card" style="width: 100%;">
            <div class="card-content" style="padding:0; overflow-x:auto;">
                <table class="shift-table" style="width:100%; border-collapse:collapse; margin:0; font-size:0.9rem;">
                    <thead>
                        <tr>
                            <th style="padding:12px 16px; text-align:left; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Meter Name</th>
                            <th style="padding:12px 16px; text-align:left; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Status</th>
                            <th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Register (kWh)</th>
                            <th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">% of Group</th>
                            <th style="padding:12px 16px; text-align:right; color:var(--text-sub); border-bottom:1px solid var(--border-color); font-weight:600;">Last Updated</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    meters.forEach(m => {
        const kwh = m.kwh !== null && m.kwh !== undefined ? formatKwh(m.kwh, 2) : "—";
        const pct = total > 0 && m.kwh != null ? ((m.kwh / total) * 100).toFixed(1) : "—";
        const isOnline = m.status === "OK";
        const statusClass = isOnline ? "meter-status-ok" : "meter-status-offline";
        const statusLabel = isOnline ? "Online" : "Offline";
        const ts = m.timestamp || "No reading";

        html += `
            <tr style="border-bottom:1px solid var(--border-color); transition: background-color 0.2s;">
                <td style="padding:12px 16px; color:var(--text-main); font-weight:500;">
                    ${m.meter_name}
                    <div style="font-size:0.75rem; color:var(--text-sub); margin-top:4px;">${m.plant} · Meter ${m.meter_id}</div>
                </td>
                <td style="padding:12px 16px;">
                    <span class="meter-status-badge ${statusClass}">${statusLabel}</span>
                </td>
                <td style="padding:12px 16px; text-align:right; color:var(--accent); font-weight:700; font-family:var(--font-mono);">
                    ${kwh}
                </td>
                <td style="padding:12px 16px; text-align:right; color:var(--text-main); font-family:var(--font-mono);">
                    ${pct !== "—" ? pct + "%" : "—"}
                </td>
                <td style="padding:12px 16px; text-align:right; color:var(--text-sub); font-size:0.8rem;">
                    ${ts}
                </td>
            </tr>
        `;
    });
    
    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;
    indContainer.innerHTML = html;
}

async function fetchAndRenderLiveGroup(groupId) {
    try {
        const res = await fetch(`/api/group_live_kpis?group_id=${groupId}`);
        if (!res.ok) return;
        const data = await res.json();

        renderLiveKpis(data);
        renderPieChart(data.meters, data.register_total_kwh);
        renderMeterCards(data.meters, data.register_total_kwh);

        if (liveStatus) {
            liveStatus.style.display = data.online_count > 0 ? "flex" : "none";
        }
    } catch (e) {
        console.error("Error loading live group data", e);
    }
}

groupSelect.addEventListener("change", (e) => {
    const groupId = e.target.value;
    const landingView = document.getElementById("landingView");
    const dashboardView = document.getElementById("dashboardView");
    const filterBar = document.getElementById("filterBar");

    if (groupId) {
        const groupObj = globalMeterGroupsDashboard.find(g => g.id == groupId);
        const groupName = groupObj ? groupObj.name : "";
        dashboardTitle.innerText = `Group: ${groupName}`;
        window.EMS?.updateFlowSteps([
            { label: groupName || "Group", active: true },
            { label: "Live KPIs" },
            { label: "Historical Analysis" },
            { label: "Export CSV" },
        ]);
        landingView.style.display = "none";
        dashboardView.style.display = "block";
        document.getElementById("btnViewLive").click();
        floatingHomeBtn.style.display = "flex";
    } else {
        dashboardTitle.innerText = "Group Analytics";
        window.EMS?.updateFlowSteps([
            { label: "Select Group", active: true },
            { label: "Live KPIs" },
            { label: "Historical Analysis" },
            { label: "Export CSV" },
        ]);
        landingView.style.display = "block";
        dashboardView.style.display = "none";
        filterBar.style.display = "none";
        floatingHomeBtn.style.display = "none";
        if (liveStatus) liveStatus.style.display = "none";
        cardsContainer.innerHTML = "";
        document.getElementById("liveKpiStrip").innerHTML = "";
        document.getElementById("liveLastUpdated").textContent = "";
        document.getElementById("pieChartContainer").innerHTML = "";
        document.getElementById("individualMetersContainer").innerHTML = "";
        if (liveGroupInterval) {
            clearInterval(liveGroupInterval);
            liveGroupInterval = null;
        }
    }
});

floatingHomeBtn.addEventListener("click", () => {
    groupSelect.value = "";
    groupSelect.dispatchEvent(new Event("change"));
});

shiftAnalysisToggle.addEventListener("change", () => {
    if (shiftAnalysisToggle.checked) customTimeToggle.checked = false;
    syncShiftUiForGroup();
    setDefaultDateRange();
    if (groupSelect.value) loadData();
});

customTimeToggle.addEventListener("change", () => {
    if (customTimeToggle.checked) shiftAnalysisToggle.checked = false;
    syncShiftUiForGroup();
    setDefaultDateRange();
    if (groupSelect.value) loadData();
});

barGraphToggle.addEventListener("change", () => {
    if (groupSelect.value && lastHistorySummary) renderEnergySummaryCard(lastHistorySummary);
    else if (groupSelect.value) loadData();
});

submitFiltersBtn.addEventListener("click", loadData);
exportGroupCsvBtn.addEventListener("click", exportGroupCsv);
exportGroupPdfBtn?.addEventListener("click", exportGroupPdf);
document.getElementById("compareLiveBtn")?.addEventListener("click", compareGroupsLive);
document.getElementById("comparePeriodBtn")?.addEventListener("click", compareGroupsPeriod);

const btnViewLive = document.getElementById("btnViewLive");
const btnViewHistory = document.getElementById("btnViewHistory");
const liveViewContainer = document.getElementById("liveViewContainer");
const historyViewContainer = document.getElementById("historyViewContainer");
const filterBar = document.getElementById("filterBar");

btnViewLive.addEventListener("click", () => {
    btnViewLive.classList.add("active-view-btn");
    btnViewHistory.classList.remove("active-view-btn");
    liveViewContainer.style.display = "block";
    historyViewContainer.style.display = "none";
    filterBar.style.display = "none";

    const groupId = groupSelect.value;
    if (groupId) {
        fetchAndRenderLiveGroup(groupId);
        if (liveGroupInterval) clearInterval(liveGroupInterval);
        liveGroupInterval = setInterval(() => fetchAndRenderLiveGroup(groupId), 5000);
    }
});

btnViewHistory.addEventListener("click", () => {
    btnViewHistory.classList.add("active-view-btn");
    btnViewLive.classList.remove("active-view-btn");
    historyViewContainer.style.display = "block";
    liveViewContainer.style.display = "none";
    filterBar.style.display = "block";

    if (liveGroupInterval) {
        clearInterval(liveGroupInterval);
        liveGroupInterval = null;
    }
    if (liveStatus) liveStatus.style.display = "none";
    if (groupSelect.value) loadData();
});

setDefaultDateRange();
setDefaultCompareRange();
syncShiftUiForGroup();
loadMeterGroupsForDashboard();
