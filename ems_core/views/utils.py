"""
ems_core/views/utils.py — Helper decorators and utilities for Django views.
"""

import json
from functools import wraps
from django.http import JsonResponse, HttpResponseRedirect
from django.shortcuts import render

def parse_json(request):
    """Safely parse JSON request body."""
    try:
        if request.body:
            return json.loads(request.body.decode("utf-8"))
        return {}
    except Exception:
        return {}

def is_logged_in(request):
    return bool(request.session.get("logged_in"))

def is_admin(request):
    return is_logged_in(request) and request.session.get("role") == "admin"

def login_required_page(view_func):
    """Redirect to /login if user is not logged in."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not is_logged_in(request):
            return HttpResponseRedirect("/login")
        return view_func(request, *args, **kwargs)
    return wrapper

def admin_required_page(view_func):
    """Redirect to /admin or /login if user is not admin."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not is_logged_in(request):
            return HttpResponseRedirect("/login")
        if request.session.get("role") != "admin":
            return HttpResponseRedirect("/admin")
        return view_func(request, *args, **kwargs)
    return wrapper

def login_required_api(view_func):
    """Return 401 JSON response if not logged in."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not is_logged_in(request):
            return JsonResponse({"detail": "Unauthorized"}, status=401)
        return view_func(request, *args, **kwargs)
    return wrapper

def admin_required_api(view_func):
    """Return 403 JSON response if not admin."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not is_logged_in(request):
            return JsonResponse({"detail": "Unauthorized"}, status=401)
        if request.session.get("role") != "admin":
            return JsonResponse({"detail": "Forbidden: Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper
