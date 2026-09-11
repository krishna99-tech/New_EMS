"""
ems_core/urls.py — Complete URL routing for the Django EMS application.
"""

from django.urls import path
from django.views.generic import RedirectView

from ems_core.views import (
    auth_views,
    dashboard_views,
    admin_views,
    meter_views,
    analytics_views,
    export_views,
    report_views,
    overview_views,
    dispatchers,
)

urlpatterns = [
    # ── Page Routes ──
    path("", dashboard_views.root_dashboard, name="root_dashboard"),
    path("group_dashboards", dashboard_views.group_dashboards_page, name="group_dashboards_page"),
    path("reports", report_views.reports_page, name="reports_page"),
    path("admin", admin_views.admin_page, name="admin_page"),
    path("admin/theme_settings", admin_views.theme_settings_page, name="theme_settings_page"),
    path("admin/users", admin_views.admin_users_page, name="admin_users_page"),
    path("login", auth_views.login_page, name="login_page"),
    path("favicon.ico", dashboard_views.favicon, name="favicon"),

    # Redirects
    path("plants", RedirectView.as_view(url="/admin#plants", permanent=True)),
    path("index.html", RedirectView.as_view(url="/", permanent=True)),

    # ── Auth API ──
    path("api/login", auth_views.api_login, name="api_login"),
    path("api/logout", auth_views.api_logout, name="api_logout"),
    path("api/auth_status", auth_views.auth_status, name="auth_status"),
    path("api/change_password", auth_views.change_password, name="change_password"),

    # ── Plants API ──
    path("api/plants", dispatchers.plants_endpoint, name="plants_endpoint"),
    path("api/plants_detailed", admin_views.get_plants_detailed, name="get_plants_detailed"),
    path("api/plants/<str:plant_name>", admin_views.delete_plant, name="delete_plant"),
    path("api/plants/<str:plant_name>/location", admin_views.update_plant_location_route, name="update_plant_location"),

    # ── Locations API ──
    path("api/locations", dispatchers.locations_endpoint, name="locations_endpoint"),
    path("api/locations/<int:location_id>", admin_views.delete_location, name="delete_location"),

    # ── Meters & Config API ──
    path("api/meters", meter_views.get_meters_list, name="get_meters_list"),
    path("api/latest", meter_views.get_latest_data, name="get_latest_data"),
    path("api/stream_latest", meter_views.stream_latest, name="stream_latest"),
    path("api/group_latest", meter_views.group_latest, name="group_latest"),
    path("api/meter_config", dispatchers.meter_config_endpoint, name="meter_config_endpoint"),
    path("api/meter_config/<int:config_id>", admin_views.delete_meter_config, name="delete_meter_config"),

    # ── Meter Groups API ──
    path("api/meter_groups", dispatchers.meter_groups_endpoint, name="meter_groups_endpoint"),
    path("api/meter_groups/<int:group_id>", admin_views.delete_meter_group, name="delete_meter_group"),
    path("api/meter_groups/<int:group_id>/location", admin_views.update_meter_group_location_route, name="update_meter_group_location"),
    path("api/meter_groups/<int:group_id>/members", admin_views.add_meter_group_member, name="add_meter_group_member"),
    path("api/meter_groups/<int:group_id>/members/<int:member_id>", admin_views.remove_meter_group_member, name="remove_meter_group_member"),
    path("api/meter_groups/presets", dispatchers.meter_groups_presets_endpoint, name="meter_groups_presets_endpoint"),

    # ── Devices API ──
    path("api/device_configs", dispatchers.device_configs_endpoint, name="device_configs_endpoint"),
    path("api/device_configs/<str:device_id>", admin_views.unregister_device_config, name="unregister_device_config"),
    path("api/device_heartbeats", admin_views.device_heartbeats, name="device_heartbeats"),

    # ── Export & Import Config ──
    path("api/export_config", admin_views.export_config, name="export_config"),
    path("api/import_config", admin_views.import_config, name="import_config"),

    # ── Users & Settings API ──
    path("api/users", dispatchers.users_endpoint, name="users_endpoint"),
    path("api/users/<int:user_id>", admin_views.delete_user, name="delete_user"),
    path("api/users/<int:user_id>/password", admin_views.update_user_password, name="update_user_password"),
    path("api/user/settings", dispatchers.user_settings_endpoint, name="user_settings_endpoint"),

    # ── Analytics API ──
    path("api/energy_summary", analytics_views.energy_summary, name="energy_summary"),
    path("api/group_energy_summary", analytics_views.group_energy_summary, name="group_energy_summary"),
    path("api/group_live_kpis", analytics_views.group_live_kpis_view, name="group_live_kpis"),
    path("api/groups/compare_live", analytics_views.groups_compare_live_view, name="groups_compare_live"),
    path("api/groups/compare", analytics_views.groups_compare_period_view, name="groups_compare"),
    path("api/incomer_shift_summary", analytics_views.incomer_shift_summary, name="incomer_shift_summary"),

    # ── Export API ──
    path("export_csv", export_views.export_csv, name="export_csv"),
    path("export_group_csv", export_views.export_group_csv, name="export_group_csv"),
    path("export_group_pdf", export_views.export_group_pdf, name="export_group_pdf"),

    # ── Reports API ──
    path("api/reports/download", report_views.download_report, name="download_report"),
    path("api/reports/download_csv", report_views.download_report_csv, name="download_report_csv"),
    path("api/reports/download_group_chart_pdf", report_views.download_group_chart_pdf, name="download_group_chart_pdf"),
    path("api/reports/download_plant_chart_pdf", report_views.download_plant_chart_pdf, name="download_plant_chart_pdf"),

    # ── Overview & Prometheus Metrics ──
    path("api/overview", overview_views.system_overview, name="system_overview"),
    path("metrics/groups", overview_views.group_metrics_prometheus, name="group_metrics_prometheus"),
]
