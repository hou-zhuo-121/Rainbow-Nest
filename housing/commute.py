import json
import math
from http.client import HTTPException
from urllib.parse import urlencode
from urllib.request import urlopen


AMAP_BASE_URL = "https://restapi.amap.com/v5/direction/"
ROUTE_ENDPOINTS = {
    "walk": "walking",
    "bike": "bicycling",
    "metro": "transit/integrated",
    "taxi": "driving",
}
REQUEST_TIMEOUT = 2.5
MAX_RESPONSE_BYTES = 256 * 1024


def route_minutes(mode, origin, destination, api_key):
    """Return the shortest duration from the requested AMap route options."""
    params = {
        "key": api_key,
        "origin": f"{origin[0]:.6f},{origin[1]:.6f}",
        "destination": f"{destination[0]:.6f},{destination[1]:.6f}",
        "show_fields": "cost",
    }
    if mode == "metro":
        params.update(city1="010", city2="010", strategy="7", AlternativeRoute="1")
    elif mode == "taxi":
        params["strategy"] = "0"

    url = f"{AMAP_BASE_URL}{ROUTE_ENDPOINTS[mode]}?{urlencode(params)}"
    try:
        with urlopen(url, timeout=REQUEST_TIMEOUT) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            return None
        payload = json.loads(body)
    except (OSError, HTTPException, ValueError):
        return None

    if not isinstance(payload, dict) or str(payload.get("status")) != "1":
        return None
    route = payload.get("route")
    if not isinstance(route, dict):
        return None
    options = route.get("transits" if mode == "metro" else "paths")
    if not isinstance(options, list):
        return None

    durations = []
    for option in options:
        if not isinstance(option, dict):
            continue
        cost = option.get("cost")
        if not isinstance(cost, dict):
            continue
        try:
            seconds = float(cost.get("duration"))
        except (TypeError, ValueError, OverflowError):
            continue
        if math.isfinite(seconds) and seconds >= 0:
            durations.append(seconds)
    return math.ceil(min(durations) / 60) if durations else None
