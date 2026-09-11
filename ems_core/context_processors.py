from .models import UserSettings


def ems_context(request):
    """Global template context processor matching the EMS FastAPI context."""
    user_id = request.session.get("user_id")
    logged_in = bool(request.session.get("logged_in"))
    username = request.session.get("username", "")
    role = request.session.get("role", "operator")

    settings_dict = {
        "theme": "light",
        "color_preset": "blue",
        "custom_primary": "#4f46e5",
        "custom_sub": "#6366f1",
    }

    if user_id:
        try:
            user_setting = UserSettings.objects.filter(user_id=user_id).first()
            if user_setting:
                settings_dict = {
                    "theme": user_setting.theme,
                    "color_preset": user_setting.color_preset,
                    "custom_primary": user_setting.custom_primary,
                    "custom_sub": user_setting.custom_sub,
                }
        except Exception:
            pass

    return {
        "logged_in": logged_in,
        "username": username,
        "role": role,
        "user_settings": settings_dict,
    }
