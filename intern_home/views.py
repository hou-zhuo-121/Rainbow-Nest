from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.templatetags.static import static
from django.views.csrf import csrf_failure as default_csrf_failure
from django.views.decorators.http import require_safe


@require_safe
def home(request):
    page = (settings.BASE_DIR / "index.html").read_text(encoding="utf-8")
    route_state = "on" if settings.AMAP_WEB_KEY else "off"
    page = page.replace(
        '<html lang="zh-CN">',
        f'<html lang="zh-CN" data-backend="django" data-amap-routes="{route_state}">',
        1,
    )
    backend_script = static("housing/backend.js")
    page = page.replace("</head>", f'<script src="{backend_script}" defer></script>\n</head>', 1)
    return HttpResponse(page, content_type="text/html; charset=utf-8")


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return JsonResponse({"error": "安全校验已过期，请刷新页面后重试。"}, status=403)
    return default_csrf_failure(request, reason=reason)
