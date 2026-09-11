from django import template
from django.templatetags.static import static

register = template.Library()


@register.simple_tag
def url_for(endpoint, **kwargs):
    """Compatibility tag for FastAPI/Jinja2 url_for('static', path='...')."""
    if endpoint == 'static':
        path = kwargs.get('path', '')
        return static(path)
    return f"/{endpoint}"
