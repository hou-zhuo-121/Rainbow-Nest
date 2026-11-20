import json
import re

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.forms import UserCreationForm
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_variables
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .models import Favorite, Listing, UserPreference


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _json_body(request):
    try:
        return json.loads(request.body)
    except (ValueError, RecursionError):
        raise ValueError("请求必须包含有效的 JSON。") from None


@sensitive_variables("data", "password")
def _credentials(request):
    data = _json_body(request)
    if not isinstance(data, dict):
        raise ValueError("请填写用户名和密码。")

    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        raise ValueError("请填写用户名和密码。")

    username = get_user_model().normalize_username(username.strip())
    max_username_length = get_user_model()._meta.get_field("username").max_length
    if not username or len(username) > max_username_length or not password or len(password) > 4096:
        raise ValueError("用户名或密码长度不符合要求。")
    return username, password


def _favorite_ids(user):
    return list(
        Favorite.objects.filter(user=user).order_by("listing_id").values_list("listing_id", flat=True)
    )


def _session_response(request, *, status=200):
    user = request.user
    payload = {
        "user": None,
        "preferences": None,
        "favorites": [],
        "csrf_token": get_token(request),
    }
    if user.is_authenticated:
        payload["user"] = {"username": user.get_username()}
        payload["preferences"] = (
            UserPreference.objects.filter(user=user).values_list("values", flat=True).first()
        )
        payload["favorites"] = _favorite_ids(user)
    return JsonResponse(payload, status=status)


@never_cache
@require_GET
def session(request):
    return _session_response(request)


@never_cache
@require_POST
@sensitive_variables("password", "form")
def register(request):
    try:
        username, password = _credentials(request)
    except ValueError as error:
        return _error(str(error), 400)

    form = UserCreationForm(
        {"username": username, "password1": password, "password2": password}
    )
    if not form.is_valid():
        error = next(iter(form.errors.as_data().values()))[0]
        return _error(error.messages[0], 400)

    try:
        with transaction.atomic():
            user = form.save()
    except IntegrityError:
        return _error("该用户名已注册。", 409)

    login(request, user)
    return _session_response(request, status=201)


@never_cache
@require_POST
@sensitive_variables("password")
def sign_in(request):
    try:
        username, password = _credentials(request)
    except ValueError as error:
        return _error(str(error), 400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return _error("用户名或密码不正确。", 401)

    login(request, user)
    return _session_response(request)


@never_cache
@require_POST
def sign_out(request):
    logout(request)
    return _session_response(request)


def _valid_preferences(values):
    return (
        isinstance(values, dict)
        and set(values) == {"gender", "mbti", "pet", "rhythm", "smoke"}
        and values["gender"] in ("女", "男")
        and isinstance(values["mbti"], str)
        and re.fullmatch(r"[EI][SN][TF][JP]", values["mbti"]) is not None
        and values["pet"] in ("has", "accept", "reject")
        and type(values["rhythm"]) is int
        and values["rhythm"] in range(4)
        and type(values["smoke"]) is int
        and values["smoke"] in range(3)
    )


@never_cache
@require_http_methods(["PUT"])
def preferences(request):
    if not request.user.is_authenticated:
        return _error("请先登录。", 401)
    try:
        values = _json_body(request)
    except ValueError as error:
        return _error(str(error), 400)

    if values is None:
        UserPreference.objects.filter(user=request.user).delete()
    elif _valid_preferences(values):
        UserPreference.objects.update_or_create(user=request.user, defaults={"values": values})
    else:
        return _error("请填写有效的性别、MBTI、宠物、作息和吸烟偏好。", 400)
    return JsonResponse({"preferences": values})


@never_cache
@require_http_methods(["PUT", "DELETE"])
def favorite(request, listing_id):
    if not request.user.is_authenticated:
        return _error("请先登录。", 401)
    if not Listing.objects.filter(pk=listing_id).exists():
        return _error("没有找到这套房源。", 404)

    if request.method == "PUT":
        Favorite.objects.get_or_create(user=request.user, listing_id=listing_id)
    else:
        Favorite.objects.filter(user=request.user, listing_id=listing_id).delete()
    return JsonResponse({"favorites": _favorite_ids(request.user)})
