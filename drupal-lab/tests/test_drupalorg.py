"""Behavioral fixtures for contribution evidence and runtime boundaries."""
import importlib.util
import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.parse
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/drupalorg.py'
spec = importlib.util.spec_from_file_location('drupalorg', SCRIPT)
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class Fake:
    def __init__(self, cli=None, http=None, pages=None):
        self.cli_data = cli or {}
        self.http_data = http or {}
        self.page_data = pages or {}
        self.calls = []

    def cli(self, command, *args, **kwargs):
        self.calls.append((command, args))
        value = self.cli_data[command]
        if callable(value):
            value = value(args)
        if isinstance(value, Exception):
            raise value
        return value

    def http(self, url, text=False):
        self.calls.append(('http', url))
        value = self.http_data[url]
        if isinstance(value, Exception):
            raise value
        return value

    def pages(self, url, params=None, **kwargs):
        self.calls.append(('pages', url, params, kwargs))
        value = self.page_data[url]
        if isinstance(value, Exception):
            raise value
        return value


class IdentityTests(unittest.TestCase):
    def test_project_scoped_work_items(self):
        a = d.canonical('settings_tray#2')
        b = d.canonical('https://git.drupalcode.org/project/settings_tray/-/work_items/2')
        self.assertEqual(a, b)
        self.assertNotEqual(a, d.canonical('inline_entity_form#2'))
        self.assertEqual(d.canonical('https://www.drupal.org/project/drupal/issues/123')['project'], 'drupal')

    def test_invalid_reference_is_not_an_inferred_branch(self):
        for ref in ['main', '--help', 'https://example.org/project/x/-/work_items/2']:
            with self.subTest(ref=ref), self.assertRaises(d.UpstreamError):
                d.canonical(ref)

    def test_existing_fork_and_push_access_do_not_post_again(self):
        fork = {'exists': True, 'gitlab_project_path': 'issue/settings_tray-2'}
        runtime = Fake(cli={'issue:get-fork': fork}, http={d.project_api('issue/settings_tray-2'): {
            'permissions': {'project_access': {'access_level': 30}}}})
        self.assertEqual(d.remote_write(runtime, 'issue:fork', ['settings_tray#2'])['state'], 'already_exists')
        self.assertEqual(d.remote_write(runtime, 'issue:get-access', ['settings_tray#2'])['state'], 'already_has_access')
        self.assertFalse(any(c[0] in ('issue:fork', 'issue:get-access') for c in runtime.calls))

    def test_migration_is_resolved_before_fork_and_mr_commands(self):
        runtime = Fake(http={d.DRUPAL + 'node/2.json': {'new_url': 'https://git.drupalcode.org/project/settings_tray/-/work_items/2'}})
        self.assertEqual(d.resolve(runtime, '2')['ref'], 'project/settings_tray#2')

    def test_legacy_handoff_requires_matching_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / 'analysis-reports/drupal-issue/2/analysis.json'
            old.parent.mkdir(parents=True)
            old.write_text(json.dumps({'project': 'settings_tray'}))
            a = d.canonical('settings_tray#2')
            self.assertEqual(d.analysis_path(tmp, a), old)
            self.assertNotEqual(d.analysis_path(tmp, d.canonical('other#2')), old)


class ContextTests(unittest.TestCase):
    def test_migrated_markdown_attachments_preserve_source_note(self):
        identity = d.canonical('settings_tray#2')
        result = d.attachment_inventory(identity, {}, [{'id': 42, 'body': '[fix](/uploads/hash/fix.patch)'}], None)
        self.assertEqual(result[0]['url'], 'https://git.drupalcode.org/project/settings_tray/uploads/hash/fix.patch')
        self.assertEqual(result[0]['source_comment_ids'], [42])

    def test_stable_ids_and_skipped_comments_and_attachments(self):
        url = 'https://www.drupal.org/project/drupal/issues/1'
        runtime = Fake(cli={'issue:show': {'field_project_machine_name': 'drupal', 'comments': [
            {'cid': '14859516', 'body_value': 'See #125'}]}, 'mr:list': {'merge_requests': []},
            'issue:get-fork': {'exists': False}}, http={d.DRUPAL + 'node/1.json': {
                'comments': [{'id': '14859516'}, {'id': '9'}]},
                d.DRUPAL + 'comment/9.json': {'comment_body': {'value': 'System change'}},
                url: '<a href="/files/issues/a.patch">patch</a><a href="/files/issues/a-interdiff.txt">diff</a>'})
        result = d.issue_context(runtime, '1')
        self.assertEqual(result['comments'][0]['url'], url + '#comment-14859516')
        self.assertEqual(result['comments'][0]['body'], 'See #125')
        self.assertEqual(result['comments'][1]['id'], '9')
        self.assertEqual({a['kind'] for a in result['attachments']}, {'patch', 'interdiff'})
        self.assertIsNone(result['root_cause'])

    def test_inaccessible_migrated_thread_is_partial_not_empty_success(self):
        def response(args):
            if '--with-comments' in args:
                raise d.UpstreamError('401 Unauthorized')
            return {'iid': 2, 'comments': []}
        runtime = Fake(cli={'issue:show': response, 'mr:list': {}, 'issue:get-fork': {}})
        result = d.issue_context(runtime, 'settings_tray#2')
        self.assertEqual(result['completeness'], 'partial')
        self.assertIn('401 Unauthorized', result['missing'])

    def test_discovery_filters_before_limit_and_orders_on_server(self):
        runtime = Fake(cli={'project:issues': {'project': 'settings_tray', 'issues': []}},
                       pages={d.project_api('project/settings_tray') + '/issues': [{'iid': 12}, {'iid': 2}]})
        result = d.discover(runtime, 'settings_tray', priority='Major', limit=1, query='ajax')
        self.assertEqual(result['items'], [{'iid': 12}])
        call = runtime.calls[-1]
        self.assertEqual(call[2]['order_by'], 'updated_at')
        self.assertEqual(call[2]['labels'], 'priority::major')
        self.assertEqual(call[2]['search'], 'ajax')
        with self.assertRaises(d.UpstreamError):
            d.discover(runtime, 'settings_tray', component='something')

    def test_classic_discovery_preserves_component_semantics(self):
        url = 'https://www.drupal.org/project/issues/rss/drupal?status=Open&categories=1&component=block.module&priorities=Major'
        runtime = Fake(cli={'project:issues': {'project_title': 'Drupal', 'issues': []}},
                       http={url: '<rss><channel><item><title>Correct issue</title><link>https://www.drupal.org/node/1</link><description>test</description></item></channel></rss>'})
        result = d.discover(runtime, 'drupal', priority='Major', component='block')
        self.assertEqual(result['backend'], 'rss')
        self.assertEqual(result['items'][0]['title'], 'Correct issue')

    def test_classic_search_retains_feed_answer_when_cli_search_is_unavailable(self):
        url = 'https://www.drupal.org/project/issues/rss/webform?status=Open&categories=All&text=ajax'
        runtime = Fake(cli={'project:issues': {'project_title': 'Webform', 'issues': []},
                            'issue:search': d.UpstreamError('search unavailable')},
                       http={url: '<rss><channel><item><title>Ajax fix</title><link>https://www.drupal.org/node/1</link></item></channel></rss>'})
        result = d.discover(runtime, 'webform', query='ajax')
        self.assertEqual(result['items'][0]['title'], 'Ajax fix')
        self.assertEqual(result['upstream_warnings'], ['search unavailable'])


class PipelineTests(unittest.TestCase):
    def test_pipeline_error_preserves_gathered_merge_request_context(self):
        runtime = Fake(cli={'mr:show': {'title': 'Keep this'}, 'mr:files': ['a.php'], 'mr:diff': {'diff': 'content'}},
                       pages={d.project_api('project/drupal') + '/merge_requests/7/discussions': []})
        with patch.object(d, 'pipeline_context', side_effect=d.UpstreamError('503 unavailable')):
            result = d.mr_context(runtime, 'project/drupal!7')
        self.assertEqual(result['metadata']['title'], 'Keep this')
        self.assertEqual(result['files'], ['a.php'])
        self.assertEqual(result['pipeline']['state'], 'unavailable')
        self.assertIn('503 unavailable', result['missing'])

    def fixture(self, sha='head', parents=None, inaccessible=False):
        mr = 'https://git.drupalcode.org/project/drupal/-/merge_requests/7'
        api = d.project_api('project/drupal')
        owner = d.project_api('42')
        job = {'id': 9, 'name': 'phpstan', 'status': 'failed', 'allow_failure': False,
               'web_url': 'https://git.drupalcode.org/issue/drupal-1/-/jobs/9'}
        runtime = Fake(cli={'mr:status': {'status': 'failed'}, 'mr:logs': {'failed_jobs': []}},
            http={api + '/merge_requests/7': {'project_id': 1, 'sha': 'head', 'source_branch': 'issue-1'},
                  owner + '/pipelines/8': {'id': 8, 'sha': sha, 'status': 'failed'},
                  owner + '/repository/commits/' + sha: {'parent_ids': parents or []},
                  owner + '/jobs/9/trace': d.UpstreamError('401') if inaccessible else 'causal error\n' + 'later output\n' * 200,
                  job['web_url'] + '/raw': d.UpstreamError('403')},
            pages={api + '/merge_requests/7/pipelines': [{'id': 8, 'project_id': 42}],
                   owner + '/pipelines/8/jobs': [job]})
        return runtime, mr

    def test_recovers_missing_blocking_job_and_full_trace_from_fork(self):
        runtime, mr = self.fixture()
        result = d.pipeline_context(runtime, mr)
        self.assertEqual(result['cli_omitted_jobs'], ['phpstan'])
        self.assertTrue(result['failed_jobs'][0]['trace'].startswith('causal error'))
        self.assertGreater(len(result['failed_jobs'][0]['trace'].splitlines()), 100)
        self.assertEqual(result['revision_relation'], 'source_head')
        self.assertTrue(result['complete'])

    def test_merge_result_is_not_assumed_stale(self):
        runtime, mr = self.fixture('merge', ['target', 'head'])
        self.assertEqual(d.pipeline_context(runtime, mr)['revision_relation'], 'merge_result_for_source_head')

    def test_unrelated_hash_and_inaccessible_trace_do_not_certify_head(self):
        runtime, mr = self.fixture('other', inaccessible=True)
        result = d.pipeline_context(runtime, mr)
        self.assertFalse(result['complete'])
        self.assertIsNone(result['failed_jobs'][0]['trace'])
        self.assertEqual(result['revision_relation'], 'unverified')

    def test_no_pipeline_is_distinct(self):
        runtime, mr = self.fixture()
        runtime.page_data[d.project_api('project/drupal') + '/merge_requests/7/pipelines'] = []
        self.assertEqual(d.pipeline_context(runtime, mr)['state'], 'no_pipeline')


class TransportTests(unittest.TestCase):
    def test_release_notes_use_the_pinned_commands_text_contract(self):
        runtime = object.__new__(d.Runtime)
        def request(payload):
            self.assertNotIn('--format=json', payload['args'])
            return {'ok': True, 'stdout': 'Release fixes the reported bug.'}
        runtime.request = request
        result = runtime.cli('project:release-notes', 'webform', '6.3.1')
        self.assertEqual(result['text'], 'Release fixes the reported bug.')
        self.assertEqual(result['source_url'], 'https://www.drupal.org/project/webform/releases/6.3.1')

    def test_pagination_does_not_drop_jobs_on_second_page(self):
        runtime = object.__new__(d.Runtime)
        runtime.http = lambda url: list(range(100)) if urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['page'] == ['1'] else ['blocking job']
        self.assertEqual(runtime.pages('https://git.drupalcode.org/api/v4/jobs')[-1], 'blocking job')
        runtime.http = lambda url: list(range(100))
        with self.assertRaises(d.UpstreamError):
            runtime.pages('https://git.drupalcode.org/api/v4/jobs', max_pages=2)

    def test_secret_and_argument_boundaries_use_private_scratch_not_argv_or_receipts(self):
        runtime = object.__new__(d.Runtime)
        runtime.phar = '/tmp/drupalorg.phar'
        runtime.token = 'test-token-never-in-argv'
        runtime.timeout = 1
        runtime.output = None
        runtime.receipts = []
        def execute(argv, **kwargs):
            if argv[0] == 'git':
                return subprocess_result('')
            self.assertEqual(argv[:5], ['ddev', 'exec', '--skip-hooks', '--raw=true', 'php'])
            self.assertNotIn(runtime.token, repr(argv))
            payload = next((runtime.worktree / '.ddev/drupalorg/requests').glob('*.php'))
            self.assertIn('$request', payload.read_text())
            self.assertEqual(payload.stat().st_mode & 0o777, 0o600)
            return subprocess_result('{"ok":true,"status":200,"body":"[]"}')
        with tempfile.TemporaryDirectory() as tmp, patch.object(d.subprocess, 'run', side_effect=execute):
            runtime.worktree = Path(tmp).resolve()
            runtime.http('https://git.drupalcode.org/api/v4/issues?state=opened&per_page=100')
            self.assertEqual(list((runtime.worktree / '.ddev/drupalorg/requests').glob('*.php')), [])
        self.assertNotIn(runtime.token, json.dumps(runtime.receipts))

    def test_read_path_rejects_mutation_and_checkout(self):
        runtime = object.__new__(d.Runtime)
        for command in ['issue:comment', 'issue:branch', 'issue:checkout', 'issue:apply']:
            with self.subTest(command=command), self.assertRaises(d.UpstreamError):
                runtime.cli(command)


class PostingTests(unittest.TestCase):
    def body(self, root, text='The fix preserves the reported behavior. Not checked: production data.\n', **overrides):
        path = Path(root) / 'body.md'
        path.write_text(text)
        gate = {key: 'Recorded test evidence' for key in d.GATE_FIELDS}
        gate.update(body_sha256=hashlib.sha256(text.encode()).hexdigest(), chris_approved=False)
        gate.update(overrides)
        Path(str(path) + '.gate.json').write_text(json.dumps(gate))
        return path

    def test_comment_cannot_bypass_gate_with_authorized_dispatch(self):
        runtime = Fake(cli={'issue:comment': {'posted': True}})
        with tempfile.TemporaryDirectory() as tmp:
            path = self.body(tmp)
            Path(str(path) + '.gate.json').unlink()
            with self.assertRaises(OSError):
                d.remote_write(runtime, 'issue:comment', ['settings_tray#2', '--file=' + str(path)])
        self.assertFalse(any(c[0] == 'issue:comment' for c in runtime.calls))

    def test_changed_body_and_empty_gate_answers_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.body(tmp)
            path.write_text('Changed after approval.')
            with self.assertRaises(d.UpstreamError):
                d.validate_post(path, ['project/settings_tray'])
            path = self.body(tmp, proof='')
            with self.assertRaises(d.UpstreamError):
                d.validate_post(path, ['project/settings_tray'])

    def test_human_written_maintainer_requires_exact_user_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = Path(tmp) / 'maintainers.json'
            registry.write_text(json.dumps([{'project': 'project/example'}]))
            path = self.body(tmp)
            with self.assertRaises(d.UpstreamError):
                d.validate_post(path, ['project/example'], maintainers_path=registry)
            path = self.body(tmp, chris_approved=True)
            d.validate_post(path, ['project/example'], maintainers_path=registry)

    def test_numeric_migrated_comment_and_split_file_are_normalized(self):
        runtime = Fake(cli={'issue:comment': {'posted': True}},
                       http={d.DRUPAL + 'node/2.json': {'new_url': 'https://git.drupalcode.org/project/settings_tray/-/work_items/2'}})
        with tempfile.TemporaryDirectory() as tmp:
            path = self.body(tmp)
            d.remote_write(runtime, 'issue:comment', ['2', '--file', str(path)])
            self.assertEqual(runtime.calls[-1], ('issue:comment', ('project/settings_tray#2', '--file=' + str(path))))

    def test_inline_posts_and_mismatched_slash_commands_are_refused(self):
        runtime = Fake(cli={'issue:comment': {}, 'issue:label': {}})
        with self.assertRaises(d.UpstreamError):
            d.remote_write(runtime, 'issue:comment', ['settings_tray#2', '--message=LGTM'])
        with tempfile.TemporaryDirectory() as tmp:
            path = self.body(tmp, '/do:label ~state::needsWork\n')
            with self.assertRaises(d.UpstreamError):
                d.remote_write(runtime, 'issue:label', ['settings_tray#2', 'state::needsReview'], str(path))
            path = self.body(tmp, '/do:label ~state::needsReview\n')
            d.remote_write(runtime, 'issue:label', ['settings_tray#2', 'state::needsReview'], str(path))

    def test_slop_and_stdin_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            for text in ['## Heading\nA fix.', 'Happy to help.', 'word ' * 151]:
                path = self.body(tmp, text)
                with self.assertRaises(d.UpstreamError):
                    d.validate_post(path, ['project/settings_tray'])
        with self.assertRaises(d.UpstreamError):
            d.normalize_files(['--file', '-'])


def subprocess_result(stdout):
    return type('Result', (), {'returncode': 0, 'stdout': stdout})()


if __name__ == '__main__':
    unittest.main()
