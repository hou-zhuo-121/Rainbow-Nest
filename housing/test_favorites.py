import json
from urllib.parse import quote

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from .models import Favorite, Listing


class FavoriteTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.first = get_user_model().objects.create_user(username="实习生")
        cls.second = get_user_model().objects.create_user(username="second")
        for pk in ("a", "b"):
            Listing.objects.create(
                pk=pk, district="海淀区", area="中关村", community="样本小区",
                room_type="次卧", layout="两室", monthly_rent_cny=3000,
                min_lease_days=30, max_lease_days=180,
                available_from="2027-03-01", available_until_exclusive="2027-07-01",
                longitude_gcj02_synthetic="116.320000", latitude_gcj02_synthetic="39.980000",
            )

    def merge(self, ids, client=None, **kwargs):
        return (client or self.client).post(
            reverse("merge-favorites"),
            json.dumps({"listing_ids": ids}),
            content_type="application/json",
            **kwargs,
        )

    def test_merge_preserves_account_favorites_and_is_idempotent(self):
        self.client.force_login(self.first)
        Favorite.objects.create(user=self.first, listing_id="a")
        for _ in range(2):
            response = self.merge(
                ["a", "b", "b", "deleted"],
                headers={"X-Favorites-Account": quote(self.first.username)},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"favorites": ["a", "b"]})
        self.assertEqual(Favorite.objects.count(), 2)
        response = self.client.delete(reverse("favorite", args=["b"]))
        self.assertEqual(response.json(), {"favorites": ["a"]})
        self.assertEqual(self.client.get(reverse("session")).json()["favorites"], ["a"])

    def test_guest_and_stale_account_cannot_write(self):
        self.assertEqual(self.merge(["b"]).status_code, 401)
        self.client.force_login(self.second)
        headers = {"X-Favorites-Account": quote(self.first.username)}
        self.assertEqual(self.merge(["b"], headers=headers).status_code, 409)
        self.assertEqual(self.client.put(reverse("favorite", args=["b"]), headers=headers).status_code, 409)
        self.assertFalse(Favorite.objects.exists())

    def test_merge_validates_batch_before_writing(self):
        self.client.force_login(self.first)
        for batch in (["a", 1], ["a", " "], ["a"] * 201, "a"):
            with self.subTest(batch=batch):
                self.assertEqual(self.merge(batch).status_code, 400)
        self.assertFalse(Favorite.objects.exists())

    def test_merge_requires_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.first)
        self.assertEqual(self.merge(["a"], client=client).status_code, 403)
        session = client.get(reverse("session")).json()
        response = self.merge(["a"], client=client, headers={"X-CSRFToken": session["csrf_token"]})
        self.assertEqual(response.status_code, 200)
