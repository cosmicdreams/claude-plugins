#!/usr/bin/env python3
"""SSRF-safe, bounded article text prefetcher for ideas-funnel coordinators."""
import argparse
import html
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit

from runtime import canonical

MAX_BYTES = 512 * 1024
DEFAULT_TEXT_LIMIT = 8000
MAX_REDIRECTS = 5
SCRIPT_STYLE = re.compile(r'<(script|style|noscript)[^>]*>.*?</\1>', re.I | re.S)
HTML_TAG = re.compile(r'<[^>]+>')
WHITESPACE = re.compile(r'\s+')


def resolve_public_ip(url):
    """Resolve hostname and return the first verified global IP address."""
    canonical(url)
    p = urlsplit(url)
    host = p.hostname
    if not host:
        raise ValueError('URL missing hostname')
    port = p.port or (443 if p.scheme.lower() == 'https' else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f'DNS resolution failed for {host}: {exc}') from None
    if not infos:
        raise ValueError(f'No addresses resolved for {host}')
    chosen = None
    for _, _, _, _, sockaddr in infos:
        ip = ipaddress.ip_address(sockaddr[0])
        if not ip.is_global or ip.is_multicast:
            raise ValueError(f'refusing non-global address {ip} for {host}')
        if chosen is None:
            chosen = str(ip)
    return chosen


def html_to_text(raw_bytes, limit=DEFAULT_TEXT_LIMIT):
    text = raw_bytes.decode('utf-8', errors='replace')
    text = SCRIPT_STYLE.sub(' ', text)
    text = HTML_TAG.sub(' ', html.unescape(text))
    text = WHITESPACE.sub(' ', text).strip()
    truncated = len(text) > limit
    if truncated:
        text = text[:limit].rstrip() + '...'
    return text, truncated


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _make_pinned_opener(pinned_ip):
    """Build a urllib opener that connects directly to pinned_ip while preserving TLS SNI."""
    class PinnedHTTPConnection(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.create_connection((pinned_ip, self.port), self.timeout)

    class PinnedHTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            raw = socket.create_connection((pinned_ip, self.port), self.timeout)
            try:
                ctx = self._context if getattr(self, '_context', None) else ssl.create_default_context()
                self.sock = ctx.wrap_socket(raw, server_hostname=self.host)
            except Exception:
                raw.close()
                raise

    class PinnedHTTPHandler(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(PinnedHTTPConnection, req)

    class PinnedHTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(PinnedHTTPSConnection, req)

    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), PinnedHTTPHandler(), PinnedHTTPSHandler(), _NoRedirect()
    )


def prefetch(url, timeout=15, max_bytes=MAX_BYTES, text_limit=DEFAULT_TEXT_LIMIT,
             resolve_host=resolve_public_ip, opener=None):
    try:
        current = canonical(url)
    except ValueError as exc:
        return {'url': url, 'final_url': url, 'status': None,
                'text': '', 'truncated': False, 'error': str(exc)}
    headers = {
        'User-Agent': 'ideas-funnel/3.0',
        'Accept': 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.5',
    }
    for hop in range(MAX_REDIRECTS + 1):
        try:
            pinned_ip = resolve_host(current)
            active_opener = opener if opener is not None else _make_pinned_opener(pinned_ip)
            req = urllib.request.Request(current, headers=headers)
            with active_opener.open(req, timeout=timeout) as resp:
                deadline = time.monotonic() + max(timeout, 20)
                chunks, size = [], 0
                truncated_bytes = False
                while size < max_bytes:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('prefetch deadline exceeded')
                    chunk = resp.read(min(65536, max_bytes - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                if size >= max_bytes:
                    truncated_bytes = True
                data = b''.join(chunks)
                text, truncated_text = html_to_text(data, limit=text_limit)
                return {
                    'url': url,
                    'final_url': current,
                    'status': getattr(resp, 'status', 200),
                    'text': text,
                    'truncated': truncated_bytes or truncated_text,
                    'error': None,
                }
        except urllib.error.HTTPError as exc:
            code, location = exc.code, exc.headers.get('Location') if exc.headers else None
            exc.close()
            if code in (301, 302, 303, 307, 308) and location:
                if hop >= MAX_REDIRECTS:
                    return {'url': url, 'final_url': current, 'status': code,
                            'text': '', 'truncated': False, 'error': 'too many redirects'}
                try:
                    current = canonical(urljoin(current, location))
                except ValueError as val_exc:
                    return {'url': url, 'final_url': current, 'status': code,
                            'text': '', 'truncated': False, 'error': str(val_exc)}
                continue
            return {'url': url, 'final_url': current, 'status': code,
                    'text': '', 'truncated': False, 'error': f'HTTP {code}'}
        except (OSError, ValueError, TimeoutError) as exc:
            return {'url': url, 'final_url': current, 'status': None,
                    'text': '', 'truncated': False, 'error': str(exc)}
    return {'url': url, 'final_url': current, 'status': None,
            'text': '', 'truncated': False, 'error': 'too many redirects'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--timeout', type=int, default=15)
    parser.add_argument('--text-limit', type=int, default=DEFAULT_TEXT_LIMIT)
    args = parser.parse_args()
    result = prefetch(args.url, timeout=args.timeout, text_limit=args.text_limit)
    print(json.dumps(result, indent=2))
    if result['error']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
