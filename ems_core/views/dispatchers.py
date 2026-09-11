"""
ems_core/views/dispatchers.py — Method dispatchers for endpoints that support multiple HTTP methods.
"""

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ems_core.views import admin_views, meter_views

@csrf_exempt
def plants_endpoint(request):
    if request.method == "POST":
        return admin_views.add_plant(request)
    elif request.method == "GET":
        return meter_views.get_plants_list(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def locations_endpoint(request):
    if request.method == "POST":
        return admin_views.add_location(request)
    elif request.method == "GET":
        return admin_views.get_locations(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def meter_config_endpoint(request):
    if request.method == "POST":
        return admin_views.save_meter_config(request)
    elif request.method == "GET":
        return admin_views.get_meter_configs(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def meter_groups_endpoint(request):
    if request.method == "POST":
        return admin_views.create_meter_group(request)
    elif request.method == "GET":
        return admin_views.get_meter_groups(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def meter_groups_presets_endpoint(request):
    if request.method == "POST":
        return admin_views.create_group_preset(request)
    elif request.method == "GET":
        return admin_views.list_group_presets(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def device_configs_endpoint(request):
    if request.method == "POST":
        return admin_views.register_device_config(request)
    elif request.method == "GET":
        return admin_views.list_device_configs(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def users_endpoint(request):
    if request.method == "POST":
        return admin_views.create_user(request)
    elif request.method == "GET":
        return admin_views.get_users(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)

@csrf_exempt
def user_settings_endpoint(request):
    if request.method == "POST":
        return admin_views.update_user_settings(request)
    elif request.method == "GET":
        return admin_views.get_user_settings(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)
