import re
from urllib.parse import unquote

from django.contrib.staticfiles import finders
from django.test import SimpleTestCase, override_settings


class HomeViewTests(SimpleTestCase):
    @override_settings(STATIC_URL="/demo-static/")
    def test_home_serves_split_assets_from_the_configured_static_url(self):
        response = self.client.get("/")
        self.assertContains(response, 'data-backend="django"')
        self.assertContains(response, 'src="/demo-static/housing/backend.js"')
        self.assertNotContains(response, "housing/static/housing/frontend/")

        sources = re.findall(
            r'(?:href|src)="/demo-static/(housing/frontend/[^"]+)"',
            response.content.decode(response.charset),
        )
        self.assertIn("housing/frontend/pages/main.js", sources)
        self.assertTrue(any(path.endswith(".css") for path in sources))
        for path in sources:
            with self.subTest(path=path):
                self.assertIsNotNone(finders.find(unquote(path)))
