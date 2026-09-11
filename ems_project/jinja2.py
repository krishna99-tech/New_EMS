"""
ems_project/jinja2.py — Jinja2 template environment for full template compatibility.
"""

from django.templatetags.static import static
from django.urls import reverse
from jinja2 import Environment


def url_for(endpoint, **values):
    if endpoint == "static":
        path = values.get("path", "")
        return static(path)
    try:
        return reverse(endpoint, kwargs=values)
    except Exception:
        return f"/{endpoint}"


def environment(**options):
    env = Environment(**options)
    env.globals.update({
        "static": static,
        "url": reverse,
        "url_for": url_for,
    })
    return env
