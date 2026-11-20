import json
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .commute import ROUTE_ENDPOINTS, route_minutes
from .models import Listing


MAX_LISTINGS = 8
MAX_WORKERS = 4


@require_POST
def commutes(request):
    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({"error": "请求必须包含有效的 JSON。"}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({"error": "请求必须是 JSON 对象。"}, status=400)

    mode = payload.get("mode")
    if not isinstance(mode, str) or mode not in ROUTE_ENDPOINTS:
        return JsonResponse({"error": "请选择步行、骑行、地铁或打车。"}, status=400)

    destination = payload.get("destination")
    if not isinstance(destination, dict):
        return JsonResponse({"error": "请提供有效的目的地经纬度。"}, status=400)
    lng, lat = destination.get("lng"), destination.get("lat")
    if (
        type(lng) not in (int, float)
        or type(lat) not in (int, float)
        or not (-180 <= lng <= 180 and -90 <= lat <= 90)
    ):
        return JsonResponse({"error": "请提供有效的目的地经纬度。"}, status=400)

    ids = payload.get("listing_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_LISTINGS or not all(
        isinstance(listing_id, str) and 0 < len(listing_id.strip()) <= 128 for listing_id in ids
    ):
        return JsonResponse({"error": f"请提供 1 至 {MAX_LISTINGS} 个房源编号。"}, status=400)

    api_key = (getattr(settings, "AMAP_WEB_KEY", "") or "").strip()
    if not api_key:
        return JsonResponse({"configured": False, "routes": {}})

    listings = Listing.objects.in_bulk(dict.fromkeys(listing_id.strip() for listing_id in ids))
    routes = {}
    if listings:
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(listings))) as executor:
            pending = {
                listing_id: executor.submit(
                    route_minutes,
                    mode,
                    (listing.longitude_gcj02_synthetic, listing.latitude_gcj02_synthetic),
                    (lng, lat),
                    api_key,
                )
                for listing_id, listing in listings.items()
            }
            for listing_id, future in pending.items():
                duration = future.result()
                if duration is not None:
                    routes[listing_id] = {"min": duration, "source": "amap"}
    return JsonResponse({"configured": True, "routes": routes})
