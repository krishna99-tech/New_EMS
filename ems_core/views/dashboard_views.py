from django.shortcuts import render, redirect
from django.http import FileResponse, HttpResponseRedirect
from django.conf import settings
from .auth_views import require_login_page


def index(request):
    """Main Energy Monitoring Dashboard view."""
    return render(request, "index.html", {"active_nav": "dashboard"})


@require_login_page
def group_dashboards(request):
    """Group analytics and aggregated dashboard view."""
    group_id = request.GET.get("group")
    return render(
        request,
        "group_dashboard.html",
        {
            "active_nav": "group_dashboards",
            "initial_group_id": group_id,
        }
    )


def redirect_plants(request):
    return HttpResponseRedirect("/admin#plants")


def favicon(request):
    favicon_path = settings.BASE_DIR / "static" / "images" / "logo.png"
    if favicon_path.exists():
        return FileResponse(open(favicon_path, "rb"), content_type="image/png")
    return HttpResponseRedirect("/static/images/logo.png")


root_dashboard = index
group_dashboards_page = group_dashboards

