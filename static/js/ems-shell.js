/* Shell JS — sidebar, theme, clock (single source, no duplicate logic) */
(function () {
    const SIDEBAR_KEY = "ems_sidebar_collapsed";
    const sunIcon = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    const moonIcon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';

    function getShiftName(dt) {
        const h = dt.getHours();
        if (h >= 6 && h < 14) return "Shift A";
        if (h >= 14 && h < 22) return "Shift B";
        return "Shift C";
    }

    function updateClock() {
        const el = document.getElementById("currentTime");
        if (!el) return;
        const now = new Date();
        el.textContent = `${now.toLocaleString()} | ${getShiftName(now)}`;
    }

    function applyThemeIcon() {
        const icon = document.getElementById("themeIcon");
        if (!icon) return;
        icon.innerHTML = document.body.classList.contains("light-mode") ? sunIcon : moonIcon;
    }

    function initTheme() {
        if (localStorage.getItem("theme") === "light") {
            document.body.classList.add("light-mode");
        }
        applyThemeIcon();
        document.getElementById("themeToggle")?.addEventListener("click", () => {
            document.body.classList.toggle("light-mode");
            localStorage.setItem("theme", document.body.classList.contains("light-mode") ? "light" : "dark");
            applyThemeIcon();
            document.dispatchEvent(new CustomEvent("ems-theme-changed"));
        });
    }

    // Run theme initialization immediately to prevent flash and ensure body has correct class before other scripts run
    initTheme();

    function initSidebar() {
        const sidebar = document.getElementById("emsSidebar");
        const backdrop = document.getElementById("emsSidebarBackdrop");
        const toggle = document.getElementById("emsSidebarToggle");
        const menuBtn = document.getElementById("emsMenuBtn");
        if (!sidebar) return;

        if (localStorage.getItem(SIDEBAR_KEY) === "true") {
            sidebar.classList.add("is-collapsed");
        }

        function closeMobile() {
            sidebar.classList.remove("is-open");
            backdrop?.classList.remove("is-visible");
        }

        function openMobile() {
            sidebar.classList.add("is-open");
            backdrop?.classList.add("is-visible");
        }

        toggle?.addEventListener("click", () => {
            if (window.innerWidth <= 900) {
                if (sidebar.classList.contains("is-open")) closeMobile();
                else openMobile();
            } else {
                sidebar.classList.toggle("is-collapsed");
                localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains("is-collapsed"));
            }
        });

        menuBtn?.addEventListener("click", () => {
            if (sidebar.classList.contains("is-open")) closeMobile();
            else openMobile();
        });
        backdrop?.addEventListener("click", closeMobile);

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeMobile();
        });
    }

    async function loadOverviewStats(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        try {
            const res = await fetch("/api/overview");
            if (!res.ok) throw new Error("overview");
            const d = await res.json();
            container.innerHTML = `
                <div class="overview-card premium-stat-card">
                    <div class="stat-icon-wrapper"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"></path><path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path><path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path></svg></div>
                    <div class="stat-content">
                        <label>Plants</label>
                        <div class="stat-value">${d.plant_count}</div>
                        <div class="stat-meta">configured</div>
                    </div>
                </div>
                <div class="overview-card premium-stat-card">
                    <div class="stat-icon-wrapper" style="color: var(--accent-primary);"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg></div>
                    <div class="stat-content">
                        <label>Meters</label>
                        <div class="stat-value">${d.meter_count}</div>
                        <div class="stat-meta"><span style="color: var(--success);">${d.online_meter_count} online</span></div>
                    </div>
                </div>
                <div class="overview-card premium-stat-card">
                    <div class="stat-icon-wrapper"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg></div>
                    <div class="stat-content">
                        <label>Groups</label>
                        <div class="stat-value">${d.group_count}</div>
                        <div class="stat-meta">${d.group_member_count} members</div>
                    </div>
                </div>
                <div class="overview-card premium-stat-card">
                    <div class="stat-icon-wrapper" style="color: var(--success);"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
                    <div class="stat-content">
                        <label>Last Reading</label>
                        <div class="stat-value" style="font-size:1.1rem;">${d.last_reading || "—"}</div>
                        <div class="stat-meta">${d.production_day_note}</div>
                    </div>
                </div>`;
        } catch {
            container.innerHTML = `<p class="inline-note">Could not load overview.</p>`;
        }
    }

    function updateFlowSteps(steps) {
        const bar = document.querySelector("#flowBar .flow-steps");
        if (!bar || !steps?.length) return;
        bar.innerHTML = steps.map((step, i) => {
            const sep = i > 0 ? '<span class="flow-step-sep">→</span>' : "";
            const cls = step.active ? "is-active" : "";
            if (step.href && !step.active) {
                return `${sep}<a href="${step.href}" class="flow-step">${step.label}</a>`;
            }
            return `${sep}<span class="flow-step ${cls}">${step.label}</span>`;
        }).join("");
    }

    function initProfileDropdown() {
        const dropdown = document.getElementById("profileDropdown");
        const btn = document.getElementById("profileDropdownBtn");
        btn?.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdown?.classList.toggle("open");
        });
        document.addEventListener("click", () => dropdown?.classList.remove("open"));
        document.getElementById("logoutBtn")?.addEventListener("click", async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.href = "/login";
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        initSidebar();
        initProfileDropdown();
        updateClock();
        setInterval(updateClock, 1000);
        loadOverviewStats("overviewStats");
    });

    window.EMS = window.EMS || {};
    window.EMS.loadOverviewStats = loadOverviewStats;
    window.EMS.getShiftName = getShiftName;
    window.EMS.updateFlowSteps = updateFlowSteps;
})();
