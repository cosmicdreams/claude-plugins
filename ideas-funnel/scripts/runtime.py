"""Shared on-disk contract. All funnel writers use the same advisory lock."""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = {'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'utm_source', 'utm_medium',
            'utm_campaign', 'utm_term', 'utm_content', 'utm_id'}


def canonical(url):
    p = urlsplit(url.strip())
    if p.scheme.lower() not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('expected a public http(s) URL without credentials')
    host = p.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    port = p.port
    if port and (p.scheme.lower(), port) not in (('http', 80), ('https', 443)):
        host += ':' + str(port)
    query = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                       if k.lower() not in TRACKING])
    return urlunsplit((p.scheme.lower(), host, p.path or '/', query, ''))


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def locked(vault):
    path = Path(vault) / '_meta' / 'ideas-funnel.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('another funnel writer holds the lock') from None
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)
