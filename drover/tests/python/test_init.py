"""Unit tests for drover.init (slice 4).

Covers breadcrumb discovery (drush yml, composer, ddev), the app-match
scorer, and the manifest builder. The CLI's interactive paths
(--app override, ambiguity bail-out) are exercised via cli_main with a
mocked AcquiaClient.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve()
INIT_PATH = HERE.parents[2] / "scripts" / "init.py"


def load_init():
    spec = importlib.util.spec_from_file_location("drover_init", INIT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


init = load_init()


# --- Helpers --------------------------------------------------------------

def _make_project(td: pathlib.Path, *, drush_yml: str | None = None,
                  composer: dict | None = None, ddev_name: str | None = None,
                  pipelines: bool = False):
    if drush_yml is not None:
        d = td / "drush" / "sites"
        d.mkdir(parents=True, exist_ok=True)
        (d / "self.site.yml").write_text(drush_yml)
    if composer is not None:
        (td / "composer.json").write_text(json.dumps(composer))
    if ddev_name is not None:
        (td / ".ddev").mkdir(exist_ok=True)
        (td / ".ddev" / "config.yaml").write_text(f"name: {ddev_name}\n")
    if pipelines:
        (td / "acquia-pipelines.yml").write_text("# placeholder\n")


# --- Drush parser ---------------------------------------------------------

class DrushParserTests(unittest.TestCase):
    def test_basic_drush_site_yml(self):
        text = """
prod:
  host: pncbprod.ssh.prod.acquia-sites.com
  uri: 'https://www.pncb.org'
  user: pncb.prod
dev:
  host: pncbdev.ssh.prod.acquia-sites.com
  uri: 'https://dev.pncb.org'
  user: pncb.dev
"""
        envs = init._parse_drush_site_yml(text)
        self.assertEqual(len(envs), 2)
        self.assertEqual(envs[0]["name"], "prod")
        self.assertEqual(envs[0]["host"],
                         "pncbprod.ssh.prod.acquia-sites.com")
        self.assertEqual(envs[0]["uri"], "https://www.pncb.org")
        self.assertEqual(envs[1]["name"], "dev")

    def test_skips_blocks_without_host_or_uri(self):
        text = """
local:
  paths:
    drush-script: drush
prod:
  host: example.com
  uri: 'https://example.com'
"""
        envs = init._parse_drush_site_yml(text)
        self.assertEqual([e["name"] for e in envs], ["prod"])

    def test_handles_unquoted_uri(self):
        text = "prod:\n  uri: https://example.com\n"
        envs = init._parse_drush_site_yml(text)
        self.assertEqual(envs[0]["uri"], "https://example.com")


# --- Breadcrumbs ---------------------------------------------------------

class DiscoverBreadcrumbsTests(unittest.TestCase):
    def test_drush_aliases_found(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root, drush_yml=(
                "prod:\n"
                "  host: pncbprod.ssh.prod.acquia-sites.com\n"
                "  uri: 'https://www.pncb.org'\n"
            ))
            bc = init.discover_breadcrumbs(root)
            self.assertEqual(len(bc.drush_envs), 1)
            self.assertEqual(bc.drush_envs[0]["uri"], "https://www.pncb.org")

    def test_composer_signals(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root, composer={
                "name": "vendor/pncb",
                "require": {"acquia/blt": "^14.0"},
            })
            bc = init.discover_breadcrumbs(root)
            self.assertEqual(bc.composer_name, "vendor/pncb")
            self.assertEqual(bc.composer_acquia_deps, ["acquia/blt"])

    def test_ddev_name_extracted(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root, ddev_name="pncb-local")
            bc = init.discover_breadcrumbs(root)
            self.assertEqual(bc.ddev_name, "pncb-local")

    def test_acquia_pipelines_marker(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root, pipelines=True)
            bc = init.discover_breadcrumbs(root)
            self.assertTrue(bc.has_acquia_pipelines)
            self.assertTrue(bc.is_acquia_project())

    def test_empty_project(self):
        with tempfile.TemporaryDirectory() as td:
            bc = init.discover_breadcrumbs(pathlib.Path(td))
            self.assertTrue(bc.empty())
            self.assertFalse(bc.is_acquia_project())

    def test_name_candidates(self):
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"uri": "https://www.pncb.org", "host": "pncbprod.ssh.prod.acquia-sites.com"}
        ]
        bc.composer_name = "vendor/pncb-site"
        bc.ddev_name = "pncblocal"
        candidates = bc.name_candidates()
        self.assertIn("pncb", candidates)
        self.assertIn("pncbprod", candidates)
        self.assertIn("pncb-site", candidates)
        self.assertIn("pncblocal", candidates)


# --- App match scorer ----------------------------------------------------

class ScoreAppMatchTests(unittest.TestCase):
    def _bc(self, *, uris=(), hosts=(), names=()):
        bc = init.Breadcrumbs()
        if uris or hosts:
            bc.drush_envs = [
                {"uri": u, "host": h, "name": "_x"}
                for u, h in zip(
                    list(uris) + [""] * max(0, len(hosts) - len(uris)),
                    list(hosts) + [""] * max(0, len(uris) - len(hosts)),
                )
                if u or h
            ]
        if names:
            bc.composer_name = f"vendor/{names[0]}"
        return bc

    def test_domain_exact_match_dominates(self):
        bc = self._bc(uris=["https://www.pncb.org"])
        app = {"name": "Pediatric Nursing Certification Board"}
        envs = [{"domains": ["www.pncb.org", "pncb.prod.acquia-sites.com"]}]
        s = init.score_app_match(app, envs, bc)
        self.assertGreaterEqual(s, 100)

    def test_unrelated_app_zero_score(self):
        bc = self._bc(uris=["https://www.pncb.org"])
        app = {"name": "Massachusetts Port Authority"}
        envs = [{"domains": ["www.massport.com"]}]
        self.assertEqual(init.score_app_match(app, envs, bc), 0)

    def test_name_substring_scores_lower_than_domain(self):
        bc = self._bc(names=["ahri"])
        app = {"name": "AHRI"}
        envs_no_domain = [{"domains": []}]
        s_name = init.score_app_match(app, envs_no_domain, bc)
        bc2 = self._bc(uris=["https://ahri.org"])
        envs_dom = [{"domains": ["ahri.org"]}]
        s_dom = init.score_app_match(app, envs_dom, bc2)
        self.assertGreater(s_dom, s_name)


# --- Manifest builder ----------------------------------------------------

class BuildManifestTests(unittest.TestCase):
    def test_filters_to_app_error_types_only(self):
        client = mock.MagicMock()
        # Two envs each have a mix; only one of our types per env.
        client.list_log_types.side_effect = [
            [{"type": "drupal-watchdog"}, {"type": "apache-access"},
             {"type": "mysql-slow"}],
            [{"type": "apache-error"}, {"type": "php-error"},
             {"type": "varnish-request"}],
        ]
        app = {"uuid": "app-1", "name": "Acme"}
        envs = [
            {"id": "env-prod", "name": "prod", "default_domain": "p.example"},
            {"id": "env-dev", "name": "dev", "default_domain": "d.example"},
        ]
        m = init.build_manifest(client, app, envs)
        self.assertEqual(m["acquia"]["app_uuid"], "app-1")
        self.assertEqual(m["hosting"], "drupal-acquia")
        prod = next(e for e in m["acquia"]["envs"] if e["name"] == "prod")
        dev = next(e for e in m["acquia"]["envs"] if e["name"] == "dev")
        self.assertEqual(prod["types"], ["drupal-watchdog"])
        self.assertEqual(dev["types"], ["apache-error", "php-error"])

    def test_env_with_no_app_error_types_keeps_empty_list(self):
        client = mock.MagicMock()
        client.list_log_types.return_value = [
            {"type": "apache-access"}, {"type": "mysql-slow"},
        ]
        app = {"uuid": "u", "name": "X"}
        envs = [{"id": "e", "name": "ra", "default_domain": "x"}]
        m = init.build_manifest(client, app, envs)
        self.assertEqual(m["acquia"]["envs"][0]["types"], [])


# --- Project slug picking ------------------------------------------------

class PickProjectSlugTests(unittest.TestCase):
    def test_single_drush_alias_wins(self):
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"name": "prod", "__source": "pncb.site.yml"},
            {"name": "dev", "__source": "pncb.site.yml"},
        ]
        bc.composer_name = "vendor/something"
        bc.ddev_name = "docker-starter"
        slug = init._pick_project_slug(bc, {"name": "Acme"})
        self.assertEqual(slug, "pncb")

    def test_multiple_drush_aliases_falls_through(self):
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"__source": "ipn.site.yml"},
            {"__source": "unrelated.site.yml"},
        ]
        bc.composer_name = "velir/pncb-platform"
        slug = init._pick_project_slug(bc, {"name": "Acme"})
        self.assertEqual(slug, "pncb-platform")

    def test_multiple_drush_picks_by_env_domain_match(self):
        # Multi-site project (PNCB-style: ipn.site.yml + pncb.site.yml).
        # Only pncb's URI matches an actual Acquia env domain — pick it.
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"__source": "ipn.site.yml",
             "uri": "https://ipn.example.org",
             "host": "ipnprod.ssh"},
            {"__source": "pncb.site.yml",
             "uri": "https://www.pncb.org",
             "host": "pncbprod.ssh.prod.acquia-sites.com"},
        ]
        app_envs = [
            {"name": "prod",
             "domains": ["www.pncb.org", "pncb.prod.acquia-sites.com"]},
            {"name": "stage", "domains": ["stage.pncb.org"]},
        ]
        slug = init._pick_project_slug(
            bc, {"name": "Pediatric Nursing"}, app_envs,
        )
        self.assertEqual(slug, "pncb")

    def test_uri_match_preferred_over_shared_ssh_host(self):
        # PNCB-shape pathology: defunct ipn.site.yml shares the same
        # SSH host as the live pncb.site.yml. URI is the discriminator.
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"__source": "ipn.site.yml",
             "uri": "dev.ipedsnursing.org",
             "host": "pncbdev.ssh.prod.acquia-sites.com"},
            {"__source": "pncb.site.yml",
             "uri": "pncbdev.prod.acquia-sites.com",
             "host": "pncbdev.ssh.prod.acquia-sites.com"},
        ]
        app_envs = [{
            "name": "dev",
            "domains": ["pncbdev.prod.acquia-sites.com"],
            "ssh_url": "pncb.dev@pncbdev.ssh.prod.acquia-sites.com",
        }]
        slug = init._pick_project_slug(bc, {"name": "PNCB"}, app_envs)
        self.assertEqual(slug, "pncb")

    def test_multiple_drush_with_no_domain_match_falls_through(self):
        bc = init.Breadcrumbs()
        bc.drush_envs = [
            {"__source": "ipn.site.yml", "uri": "https://ipn.example"},
            {"__source": "ahri.site.yml", "uri": "https://ahri.example"},
        ]
        bc.composer_name = "vendor/myproject"
        # No drush file matches any env domain → fall through to composer
        slug = init._pick_project_slug(
            bc, {"name": "Acme"}, [{"domains": ["www.unrelated.com"]}],
        )
        self.assertEqual(slug, "myproject")

    def test_self_alias_skipped(self):
        bc = init.Breadcrumbs()
        bc.drush_envs = [{"__source": "self.site.yml"}]
        bc.composer_name = "v/myproject"
        slug = init._pick_project_slug(bc, {"name": "Acme"})
        self.assertEqual(slug, "myproject")

    def test_shared_infra_ddev_skipped(self):
        bc = init.Breadcrumbs()
        bc.ddev_name = "docker-starter"
        slug = init._pick_project_slug(bc, {"name": "Acme Corp"})
        self.assertEqual(slug, "acme-corp")

    def test_app_name_fallback(self):
        bc = init.Breadcrumbs()
        slug = init._pick_project_slug(bc, {"name": "Acme Corp"})
        self.assertEqual(slug, "acme-corp")


# --- Manifest write/read --------------------------------------------------

class WriteManifestTests(unittest.TestCase):
    def test_atomic_replace(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            init.write_manifest(root, {"x": 1})
            self.assertEqual(
                json.load(open(init.manifest_path(root))), {"x": 1},
            )
            # Overwrite
            init.write_manifest(root, {"x": 2})
            self.assertEqual(
                json.load(open(init.manifest_path(root))), {"x": 2},
            )
            # No leftover .tmp
            self.assertFalse(
                init.manifest_path(root).with_suffix(".tmp").exists(),
            )


# --- CLI integration ------------------------------------------------------

class CliTests(unittest.TestCase):
    def test_aborts_when_no_breadcrumbs(self):
        with tempfile.TemporaryDirectory() as td:
            with mock.patch.object(init, "AcquiaClient") as Client:
                rc = init.cli_main(["--project", td])
            self.assertEqual(rc, 2)
            Client.assert_not_called()

    def test_aborts_when_manifest_exists_without_force(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            (root / ".drover").mkdir()
            (root / ".drover" / "manifest.json").write_text("{}")
            rc = init.cli_main(["--project", td])
            self.assertEqual(rc, 2)

    def test_dry_run_writes_nothing_but_resolves(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root,
                          drush_yml="prod:\n  uri: 'https://www.pncb.org'\n",
                          composer={"name": "vendor/pncb",
                                    "require": {"acquia/cli": "*"}})

            client = mock.MagicMock()
            client.verify_credentials.return_value = True
            client.list_applications.return_value = [
                {"uuid": "app-1", "name": "Pediatric Nursing"},
            ]
            client.list_environments.return_value = [
                {"id": "env-prod", "name": "prod",
                 "domains": ["www.pncb.org"], "default_domain": "www.pncb.org"},
            ]
            client.list_log_types.return_value = [
                {"type": "drupal-watchdog"}, {"type": "php-error"},
                {"type": "apache-error"},
            ]
            with mock.patch.object(init, "AcquiaClient", return_value=client):
                rc = init.cli_main(["--project", td, "--dry-run"])
            self.assertEqual(rc, 0)
            self.assertFalse(init.manifest_path(root).exists())

    def test_full_flow_writes_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root,
                          drush_yml="prod:\n  uri: 'https://www.pncb.org'\n",
                          composer={"name": "vendor/pncb",
                                    "require": {"acquia/cli": "*"}})

            client = mock.MagicMock()
            client.verify_credentials.return_value = True
            client.list_applications.return_value = [
                {"uuid": "app-1", "name": "Pediatric Nursing"},
            ]
            client.list_environments.return_value = [
                {"id": "env-prod", "name": "prod",
                 "domains": ["www.pncb.org"], "default_domain": "www.pncb.org"},
                {"id": "env-stage", "name": "stage",
                 "domains": ["stage.pncb.org"], "default_domain": "stage.pncb.org"},
            ]
            client.list_log_types.return_value = [
                {"type": "drupal-watchdog"}, {"type": "php-error"},
                {"type": "apache-error"},
            ]
            with mock.patch.object(init, "AcquiaClient", return_value=client):
                rc = init.cli_main(["--project", td])
            self.assertEqual(rc, 0)
            m = json.load(open(init.manifest_path(root)))
            self.assertEqual(m["hosting"], "drupal-acquia")
            self.assertEqual(m["acquia"]["app_uuid"], "app-1")
            self.assertEqual(len(m["acquia"]["envs"]), 2)


if __name__ == "__main__":
    unittest.main()
