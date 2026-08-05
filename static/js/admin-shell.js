// Admin shell — sidebar collapse, profile dropdown, logout.
// Theme is handled globally by ems-shell.js (loaded via base.html).
document.addEventListener("DOMContentLoaded", () => {

    // ── Sidebar collapse ──────────────────────────────────────
    const sidebar = document.querySelector(".admin-sidebar");
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");

    if (sidebar && localStorage.getItem("sidebar_collapsed") === "true") {
        sidebar.classList.add("collapsed");
    }

    sidebarToggleBtn?.addEventListener("click", () => {
        sidebar?.classList.toggle("collapsed");
        localStorage.setItem("sidebar_collapsed", sidebar?.classList.contains("collapsed"));
    });

    // ── Admin theme button (delegates to ems-shell themeToggle) ──
    document.getElementById("themeToggleAdmin")?.addEventListener("click", () => {
        // Trigger the global theme toggle handled by ems-shell.js
        document.getElementById("themeToggle")?.click();
        // Update the admin dropdown icon to reflect the new state
        updateAdminThemeIcon();
    });

    // Listen for theme changes from any source and update the admin icon
    document.addEventListener("ems-theme-changed", updateAdminThemeIcon);

    function updateAdminThemeIcon() {
        const svg = document.querySelector("#themeToggleAdmin svg");
        if (!svg) return;
        const isLight = document.body.classList.contains("light-mode");
        svg.innerHTML = isLight
            ? '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
            : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }

    // Run once on load
    updateAdminThemeIcon();

});
