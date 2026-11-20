from django.contrib import admin
from django.urls import path

from housing import account_views, commute_views, listing_views
from intern_home import views

urlpatterns = [
    path("", views.home, name="home"),
    path("admin/", admin.site.urls),
    path("api/listings", listing_views.listings, name="listings"),
    path("api/listings/<str:listing_id>", listing_views.listing_detail, name="listing-detail"),
    path("api/session", account_views.session, name="session"),
    path("api/auth/register", account_views.register, name="register"),
    path("api/auth/login", account_views.sign_in, name="login"),
    path("api/auth/logout", account_views.sign_out, name="logout"),
    path("api/preferences", account_views.preferences, name="preferences"),
    path("api/favorites/<str:listing_id>", account_views.favorite, name="favorite"),
    path("api/commutes", commute_views.commutes, name="commutes"),
]
