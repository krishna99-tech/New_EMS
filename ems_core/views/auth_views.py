import json
import bcrypt
from functools import wraps

from django.http import JsonResponse, HttpResponseRedirect
from django.shortcuts import render, redirect
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from ems_core.models import EMSUser


def hash_password(password: str) -> str:
    """Hash a plain text password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain text password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def is_logged_in(request) -> bool:
    return bool(request.session.get("logged_in"))


def require_login(view_func):
    """Decorator to enforce login for JSON API views (returns 401)."""
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not is_logged_in(request):
            return JsonResponse({"error": "Unauthorized", "detail": "Authentication required"}, status=401)
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def require_admin(view_func):
    """Decorator to enforce admin role for JSON API views (returns 403)."""
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not is_logged_in(request):
            return JsonResponse({"error": "Unauthorized"}, status=401)
        if request.session.get("role") != "admin":
            return JsonResponse({"error": "Forbidden: Admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def require_login_page(view_func):
    """Decorator to enforce login for HTML views (redirects to /login)."""
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not is_logged_in(request):
            return redirect("/login")
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def login_page(request):
    if is_logged_in(request):
        return redirect("/admin")
    return render(request, "login.html")


@csrf_exempt
@require_http_methods(["POST"])
def api_login(request):
    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    username = data.get("username")
    password = data.get("password")

    user = EMSUser.objects.filter(username=username).first()
    if user and verify_password(password, user.password_hash):
        request.session["logged_in"] = True
        request.session["user_id"] = user.id
        request.session["username"] = user.username
        request.session["role"] = user.role
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Invalid credentials"}, status=401)


@csrf_exempt
@require_http_methods(["POST"])
def api_logout(request):
    request.session.flush()
    response = JsonResponse({"success": True, "message": "Logged out successfully"})
    response.delete_cookie("sessionid")
    return response


@require_http_methods(["GET"])
def api_auth_status(request):
    return JsonResponse({"logged_in": is_logged_in(request)})


@csrf_exempt
@require_login
@require_http_methods(["POST"])
def api_change_password(request):
    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    old_pw = data.get("old_password")
    new_pw = data.get("new_password")
    confirm_pw = data.get("confirm_password")

    user_id = request.session.get("user_id")
    user = EMSUser.objects.filter(id=user_id).first()

    if not user or not verify_password(old_pw, user.password_hash):
        return JsonResponse({"error": "Current password is incorrect"}, status=400)

    if not new_pw or len(new_pw) < 4:
        return JsonResponse({"error": "New password must be at least 4 characters long"}, status=400)

    if new_pw != confirm_pw:
        return JsonResponse({"error": "New password and confirmation do not match"}, status=400)

    user.password_hash = hash_password(new_pw)
    user.save(update_fields=["password_hash"])

    return JsonResponse({"success": True, "message": "Password updated successfully"})


auth_status = api_auth_status
change_password = api_change_password

