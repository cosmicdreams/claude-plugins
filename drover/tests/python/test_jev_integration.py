"""Jev integration tests for drover: cause-collapse gate, ticket
worthiness, watchdog severity, fingerprint pre-filter, and the report
plumbing. A fake jev module stands in for the network; the fallback tests
prove that without Jev every artifact is identical to a run before Jev
existed (the pre-Jev renderer input had no `jev*` keys anywhere).
"""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


jev = _load("drover_jev_client", "jev_client.py")
causes = _load("drover_causes", "causes.py")
jira_recs = _load("drover_jira_recs", "jira_recs.py")
fingerprint = _load("drover_fingerprint", "fingerprint.py")
report = _load("drover_report", "report.py")
from parsers import drupal_watchdog  # noqa: E402

MODEL = "jev-1.13.0"


class FakeJev:
    """Stands in for the jev_client module. `answer(state, questions)`
    returns the answers map; recorded calls allow request assertions."""

    fallback = staticmethod(jev.fallback)
    choice_verdict = staticmethod(jev.choice_verdict)
    score_verdict = staticmethod(jev.score_verdict)
    noul_verdict = staticmethod(jev.noul_verdict)

    def __init__(self, answer=None, *, fail_reason=None):
        self.answer = answer
        self.fail_reason = fail_reason
        self.calls: list[tuple] = []

    def availability(self):
        return True, None

    def ask(self, state, questions, **kw):
        self.calls.append((state, questions))
        if self.fail_reason:
            return {"ok": False, "reason": self.fail_reason, "detail": "", "attempts": 1}
        return {"ok": True, "model": MODEL, "answers": self.answer(state, questions),
                "usage": {}, "attempts": 1}

    def ask_items(self, items, questions, **kw):
        self.calls.append((items, questions))
        results = {}
        if self.fail_reason:
            for item_id in items:
                results[item_id] = {"ok": False, "reason": self.fail_reason}
            return {"ok": False, "reason": self.fail_reason, "model": None,
                    "requests": 1, "results": results}
        for item_id, item in items.items():
            results[item_id] = {"ok": True, "answers": self.answer(item, questions)}
        return {"ok": True, "reason": None, "model": MODEL, "requests": 1, "results": results}


def noul(p):
    return {"type": "noul", "noul": p}


def choice(option, confidence, options):
    probs = {o: (confidence if o == option else round((1 - confidence) / (len(options) - 1), 4))
             for o in options}
    return {"type": "choice", "choice": option, "confidence": confidence, "probabilities": probs}


def score(value, confidence):
    return {"type": "score", "score": value, "confidence": confidence, "probabilities": {}, "legend": {}}


def _g(fp, channel, count, summary, severity="error"):
    return {
        "fingerprint": fp, "channel": channel, "severity": severity,
        "severities": {severity: count}, "count": count, "summary": summary,
        "samples": [summary], "first_seen": "2026-04-01T00:00:00+00:00",
        "last_seen": "2026-04-30T00:00:00+00:00", "days": {"2026-04-01": count},
        "source": "watchdog",
    }


SOLR_A = _g("aaa", "acquia_search", 120, "Flood protection has blocked this Solr request")
SOLR_B = _g("bbb", "search_api", 60, "Acquia search flood: request blocked")
SOLR_C = _g("ccc", "custom", 10, "acquia search flood in custom module")
NOVEL = _g("ddd", "custom_module", 30, "Widget sync finished")


# --- causes.collapse_by_cause ----------------------------------------------

class CollapseGateTests(unittest.TestCase):
    def test_no_jev_matches_previous_behavior_and_adds_no_keys(self):
        out = causes.collapse_by_cause([SOLR_A, SOLR_B, NOVEL])
        self.assertEqual([g["member_count"] for g in out], [2, 1])
        for g in out:
            self.assertFalse(any(k.startswith("jev") for k in g), g.keys())

    def test_confident_agreement_merges(self):
        fake = FakeJev(lambda s, q: {k: noul(0.95) for k in q})
        stats = {}
        out = causes.collapse_by_cause([SOLR_A, SOLR_B], jev=fake, jev_stats=stats)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["member_count"], 2)
        self.assertEqual(out[0]["count"], 180)
        self.assertEqual(stats, {"jev": 2, "fallback": 0, "model": MODEL})
        questions = [j["question"] for j in out[0]["jev_judgments"]]
        self.assertEqual(questions, ["supports_cause", "supports_cause", "same_root_cause"])
        self.assertTrue(all(j["source"] == "jev" for j in out[0]["jev_judgments"]))
        # Request shape: one state with cause + both groups, three Nouls.
        state, asked = fake.calls[0]
        self.assertEqual(set(state["groups"]), {"g0", "g1"})
        self.assertEqual(state["cause"]["title"], "Acquia Search rate limit hit")
        self.assertEqual(set(asked), {"g0_supports", "g1_supports", "g1_same"})

    def test_uncertain_same_root_cause_keeps_groups_separate(self):
        fake = FakeJev(lambda s, q: {k: noul(0.5 if k.endswith("_same") else 0.95) for k in q})
        out = causes.collapse_by_cause([SOLR_A, SOLR_B], jev=fake)
        self.assertEqual([g["member_count"] for g in out], [1, 1])
        self.assertEqual([g["count"] for g in out], [120, 60])
        # Both keep the regex diagnosis; the split one records the uncertain verdict.
        self.assertTrue(all(g["cause_pattern_id"] == "acquia-solr-flood-protection" for g in out))
        same = [j for j in out[1]["jev_judgments"] if j["question"] == "same_root_cause"][0]
        self.assertEqual(same["verdict"], "uncertain")

    def test_confident_no_on_member_splits_only_that_member(self):
        fake = FakeJev(lambda s, q: {k: noul(0.05 if k.startswith("g2") else 0.95) for k in q})
        out = causes.collapse_by_cause([SOLR_A, SOLR_B, SOLR_C], jev=fake)
        self.assertEqual([g["count"] for g in out], [180, 10])
        self.assertEqual(out[0]["member_fingerprints"], ["aaa", "bbb"])

    def test_primary_rejected_splits_every_member(self):
        fake = FakeJev(lambda s, q: {k: noul(0.1 if k == "g0_supports" else 0.95) for k in q})
        out = causes.collapse_by_cause([SOLR_A, SOLR_B], jev=fake)
        self.assertEqual([g["member_count"] for g in out], [1, 1])

    def test_request_failure_merges_as_before_and_counts_fallback(self):
        fake = FakeJev(fail_reason="timeout")
        stats = {}
        out = causes.collapse_by_cause([SOLR_A, SOLR_B], jev=fake, jev_stats=stats)
        self.assertEqual(out[0]["member_count"], 2)
        self.assertEqual(stats, {"jev": 0, "fallback": 2})
        self.assertTrue(all(j["source"] == "fallback" and j["reason"] == "timeout"
                            for j in out[0]["jev_judgments"]))

    def test_single_member_buckets_and_undiagnosed_never_ask(self):
        fake = FakeJev(lambda s, q: {})
        causes.collapse_by_cause([SOLR_A, NOVEL], jev=fake)
        self.assertEqual(fake.calls, [])


# --- jira_recs.judge_worthiness ---------------------------------------------

class TicketWorthinessTests(unittest.TestCase):
    def test_no_jev_sidecar_has_no_jev_keys(self):
        specs = jira_recs.from_groups([dict(SOLR_A)], project_slug="p", env="prod",
                                      month_label="April 2026", total_events=200)
        data = json.loads(jira_recs.to_json(specs))
        self.assertNotIn("jev_ticket_worthiness", data[0])
        self.assertFalse(any("jev" in label for label in data[0]["labels"]))
        self.assertNotIn("Jev", data[0]["description"])

    def test_confident_worthiness_annotates_without_changing_priority(self):
        fake = FakeJev(lambda s, q: {"worth": score(2.9, 0.9)})
        stats = {}
        groups = [dict(SOLR_A), dict(NOVEL)]
        base = jira_recs.from_groups(groups, project_slug="p", env="prod",
                                     month_label="April 2026", total_events=200)
        jira_recs.judge_worthiness(groups, total_events=200, jev=fake, jev_stats=stats)
        specs = jira_recs.from_groups(groups, project_slug="p", env="prod",
                                     month_label="April 2026", total_events=200)
        # Hard rules unchanged: NOVEL (30 < 50) still gets no ticket.
        self.assertEqual([s.fingerprint for s in specs], [s.fingerprint for s in base])
        self.assertEqual(specs[0].priority, base[0].priority)
        self.assertIn("drover-jev-worth-3", specs[0].labels)
        self.assertIn("**Jev ticket-worthiness:** Urgent", specs[0].description)
        self.assertEqual(specs[0].jev_ticket_worthiness["source"], "jev")
        self.assertEqual(specs[0].jev_ticket_worthiness["threshold"],
                         jira_recs.TICKET_WORTH_CONFIDENCE_THRESHOLD)
        self.assertEqual(stats, {"jev": 1, "fallback": 0, "model": MODEL})
        self.assertIn("jev_ticket_worthiness", json.loads(jira_recs.to_json(specs))[0])
        # Only the eligible group was sent.
        self.assertEqual(list(fake.calls[0][0]), ["0"])

    def test_unconfident_worthiness_annotates_nothing(self):
        fake = FakeJev(lambda s, q: {"worth": score(1.5, 0.3)})
        groups = [dict(SOLR_A)]
        jira_recs.judge_worthiness(groups, total_events=200, jev=fake)
        specs = jira_recs.from_groups(groups, project_slug="p", env="prod",
                                     month_label="April 2026", total_events=200)
        self.assertFalse(any("jev" in label for label in specs[0].labels))
        self.assertNotIn("Jev", specs[0].description)
        self.assertEqual(specs[0].jev_ticket_worthiness["source"], "fallback")
        self.assertEqual(specs[0].jev_ticket_worthiness["reason"], "low_confidence")


# --- drupal_watchdog severity -----------------------------------------------

WATCHDOG = (
    "Apr 15 05:00:00 host pncb: https://x.org|1|custom_module|1.2.3.4|/node/1|https://r|0||Widget sync finished\n"
    "Apr 15 05:01:00 host pncb: https://x.org|1|custom_module|1.2.3.4|/node/2|https://r|0||Widget sync finished\n"
    "Apr 15 05:02:00 host pncb: https://x.org|1|migrate|1.2.3.4|/admin|https://r|1||Migration failed\n"
    "Apr 15 05:03:00 host pncb: https://x.org|1|php|1.2.3.4|/admin|https://r|1||Warning: foo\n"
)
SEV_OPTIONS = list(drupal_watchdog.SEVERITY_CRITERIA)


class WatchdogSeverityTests(unittest.TestCase):
    def test_without_jev_unchanged(self):
        events = list(drupal_watchdog.parse(WATCHDOG))
        self.assertEqual([e["severity"] for e in events], ["unknown", "unknown", "unknown", "error"])
        self.assertFalse(any("severity_source" in e["fields"] for e in events))

    def test_confident_answers_fill_unknown_only(self):
        def answer(item, q):
            return {"severity": choice("warning" if item["channel"] == "custom_module" else "error",
                                       0.9, SEV_OPTIONS)}
        fake = FakeJev(answer)
        stats = {}
        events = list(drupal_watchdog.parse(WATCHDOG, jev=fake, jev_stats=stats))
        self.assertEqual([e["severity"] for e in events], ["warning", "warning", "error", "error"])
        self.assertEqual(events[0]["fields"]["severity_source"], "jev")
        self.assertEqual(events[0]["fields"]["severity_jev"]["model"], MODEL)
        self.assertNotIn("severity_source", events[3]["fields"])   # channel table already knew
        # One verdict per distinct (channel, message), not per event.
        self.assertEqual(stats, {"jev": 2, "fallback": 0, "model": MODEL})
        self.assertEqual(len(fake.calls[0][0]), 2)

    def test_unconfident_answer_leaves_unknown(self):
        fake = FakeJev(lambda item, q: {"severity": choice("warning", 0.4, SEV_OPTIONS)})
        events = list(drupal_watchdog.parse(WATCHDOG, jev=fake))
        self.assertEqual(events[0]["severity"], "unknown")
        self.assertEqual(events[0]["fields"]["severity_source"], "fallback")
        self.assertEqual(events[0]["fields"]["severity_jev"]["reason"], "low_confidence")

    def test_request_failure_leaves_unknown(self):
        stats = {}
        events = list(drupal_watchdog.parse(WATCHDOG, jev=FakeJev(fail_reason="rate_limited"),
                                            jev_stats=stats))
        self.assertEqual([e["severity"] for e in events], ["unknown", "unknown", "unknown", "error"])
        self.assertEqual(stats, {"jev": 0, "fallback": 2})


# --- fingerprint pre-filter -------------------------------------------------

class FingerprintPrefilterTests(unittest.TestCase):
    LINES = [
        "[Tue Apr 22 10:30:15.123 2026] [php:error] [pid 123] PHP Fatal error: Uncaught TypeError\n",
        "Sun, 2026/04/14 - 14:56  | content | Saved the Error Handling Guide page\n",
        "Sun, 2026/04/14 - 14:57  | cron  | routine line without keywords\n",
    ]

    def test_hashes_unchanged_and_non_errors_dropped(self):
        fake = FakeJev(lambda item, q: {"is_error": noul(0.05 if "Saved" in item["line"] else 0.97)})
        expected = [fingerprint.process(l)["fingerprint"] for l in self.LINES[:2]]
        out = io.StringIO()
        with mock.patch.object(fingerprint, "_load_jev", return_value=fake), \
                mock.patch("sys.stdin", io.StringIO("".join(self.LINES))), redirect_stdout(out):
            fingerprint.main(["--jev-prefilter"])
        rows = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual([r["fingerprint"] for r in rows], [expected[0]])
        self.assertEqual(rows[0]["jev"]["verdict"], "yes")
        self.assertEqual(rows[0]["jev"]["source"], "jev")

    def test_without_flag_stream_is_unchanged(self):
        out = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO("".join(self.LINES))), redirect_stdout(out):
            fingerprint.main([])
        rows = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(len(rows), 2)
        self.assertFalse(any("jev" in r for r in rows))

    def test_prefilter_failure_keeps_every_keyword_hit(self):
        out = io.StringIO()
        with mock.patch.object(fingerprint, "_load_jev", return_value=FakeJev(fail_reason="timeout")), \
                mock.patch("sys.stdin", io.StringIO("".join(self.LINES))), redirect_stdout(out):
            fingerprint.main(["--jev-prefilter"])
        rows = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["jev"] == {"source": "fallback", "reason": "timeout"} for r in rows))


# --- report plumbing --------------------------------------------------------

def _make_project(td: pathlib.Path):
    (td / ".drover").mkdir(parents=True)
    (td / ".drover" / "manifest.json").write_text(json.dumps({
        "project": "pncb", "hosting": "drupal-acquia",
        "acquia": {"app_uuid": "u", "app_name": "T", "envs": [
            {"name": "prod", "env_id": "e", "default_domain": "x", "types": ["drupal-watchdog"]}]},
    }))
    (td / "2026" / "04").mkdir(parents=True)
    lines = []
    for i in range(60):
        lines.append(f"Apr 15 01:{i:02d}:00 host pncb: https://x.org|1|acquia_search|1.2.3.4|/s|https://r|0||Flood protection has blocked this Solr request\n")
        lines.append(f"Apr 15 02:{i:02d}:00 host pncb: https://x.org|1|search_api|1.2.3.4|/s|https://r|0||Acquia search flood: request blocked\n")
        lines.append(f"Apr 15 03:{i:02d}:00 host pncb: https://x.org|1|custom_module|1.2.3.4|/n|https://r|0||Widget sync finished\n")
    (td / "2026" / "04" / "2026-04-15.prod.drupal-watchdog.log").write_text("".join(lines))
    (td / ".drover" / "coverage.json").write_text(json.dumps({
        "2026-04-15": {"prod.drupal-watchdog": {"state": "present", "bytes": 1,
                                                 "updated_at": "2026-04-15T01:00:00+00:00"}}}))


def _all_answers(state_or_item, questions):
    answers = {}
    for key, q in questions.items():
        if q["type"] == "noul":
            answers[key] = noul(0.95)
        elif q["type"] == "score":
            answers[key] = score(2.0, 0.9)
        else:
            answers[key] = choice("warning", 0.9, list(q["criteria"]))
    return answers


def _strip_ts(text: str) -> str:
    import re
    return re.sub(r"\*Generated by drover at [^*]+\*", "*TS*", text)


class ReportJevTests(unittest.TestCase):
    def test_resolve_jev_respects_disable_and_missing_key(self):
        with mock.patch.dict("os.environ", {"TYPESAFE_API_KEY": "k", "JEV_DISABLED": "1"}):
            self.assertIsNone(report.resolve_jev())
        with mock.patch.dict("os.environ", {"TYPESAFE_API_KEY": ""}, clear=False):
            self.assertIsNone(report.resolve_jev())
        with mock.patch.dict("os.environ", {"TYPESAFE_API_KEY": "k", "JEV_DISABLED": ""}):
            self.assertIsNotNone(report.resolve_jev())
            self.assertIsNone(report.resolve_jev(True))   # --no-jev

    def test_without_jev_no_jev_keys_anywhere(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            for template in report.KNOWN_TEMPLATES:
                md, summary, specs = report.generate_report(root, env="prod", month="2026-04",
                                                            template=template)
                self.assertNotIn("Jev", md)
                self.assertNotIn("jev", summary)
                for s in specs:
                    self.assertNotIn("jev", jira_recs.to_json([s]))
            data = report.generate_data(root, env="prod", month="2026-04")
            self.assertNotIn("jev", json.dumps(data, default=str))

    def test_jev_none_and_jev_disabled_produce_identical_artifacts(self):
        """`jev=None` is the pre-Jev code path; a disabled module resolves
        to None too, so both must be byte-identical for every artifact."""
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            with mock.patch.dict("os.environ", {"TYPESAFE_API_KEY": "k", "JEV_DISABLED": "1"}):
                disabled = report.resolve_jev()
            self.assertIsNone(disabled)
            for template in report.KNOWN_TEMPLATES:
                a = report.generate_report(root, env="prod", month="2026-04", template=template)
                b = report.generate_report(root, env="prod", month="2026-04", template=template,
                                           jev=disabled)
                self.assertEqual(_strip_ts(a[0]), _strip_ts(b[0]))
                self.assertEqual(a[1], b[1])
                self.assertEqual(jira_recs.to_json(a[2]), jira_recs.to_json(b[2]))
            da = report.generate_data(root, env="prod", month="2026-04")
            db = report.generate_data(root, env="prod", month="2026-04", jev=disabled)
            da["generated_at"] = db["generated_at"] = "TS"
            self.assertEqual(json.dumps(da, sort_keys=True, default=str),
                             json.dumps(db, sort_keys=True, default=str))

    def test_with_jev_counts_and_footer_and_sidecar(self):
        fake = FakeJev(_all_answers)
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, specs = report.generate_report(root, env="prod", month="2026-04",
                                                        template="root-cause-summary", jev=fake)
            # 3 severity verdicts + 2 collapse verdicts + 2 ticket verdicts
            self.assertEqual(summary["jev"], {"jev": 7, "fallback": 0, "model": MODEL})
            self.assertTrue(md.rstrip().endswith(f"*Jev judgments: 7 from Jev, 0 fallback ({MODEL}).*"))
            self.assertEqual(specs[0].jev_ticket_worthiness["source"], "jev")
            data = report.generate_data(root, env="prod", month="2026-04", jev=fake)
            self.assertEqual(data["jev"]["jev"], 7)
            self.assertEqual(data["totals"]["by_severity"], {"warning": 180})
            self.assertTrue(all("jev_judgments" in g for g in data["groups_collapsed"]
                                if g["member_count"] > 1))

    def test_cli_no_jev_flag(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            out = io.StringIO()
            with mock.patch.dict("os.environ", {"TYPESAFE_API_KEY": "k", "JEV_DISABLED": ""}), \
                    mock.patch.object(report, "resolve_jev", wraps=report.resolve_jev) as resolve, \
                    redirect_stdout(out):
                rc = report.cli_main(["--project", str(root), "--month", "2026-04",
                                      "--no-prior", "--no-jev"])
            self.assertEqual(rc, 0)
            resolve.assert_called_once_with(True)
            self.assertNotIn("jev:", out.getvalue())


if __name__ == "__main__":
    unittest.main()
