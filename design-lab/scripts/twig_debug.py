"""Locate Drupal bundles on a page through Twig debug comments.

With Twig debug on, every template is preceded by `THEME HOOK: 'paragraph'`, its
`FILE NAME SUGGESTIONS` and a `BEGIN OUTPUT from '...'` comment. The bundle suggestion
(`paragraph--pricing.html.twig`, `block--banner.html.twig`) names the bundle exactly, even
when its template prints no wrapper class and embeds a component that prints no attributes.
"""

from __future__ import annotations

import json
import re

HOOK = re.compile(r"<!-- THEME HOOK: '([\w-]+)' -->")
SUGGESTIONS = re.compile(r"<!-- FILE NAME SUGGESTIONS:(.*?)-->", re.S)
BEGIN = re.compile(r"<!-- [^\n]*BEGIN [^\n]*OUTPUT from '([^']+)' -->")
NAME = re.compile(r"([\w-]+\.html\.twig)")


def enabled(html: str) -> bool:
    return "<!-- THEME DEBUG -->" in html or bool(BEGIN.search(html))


def suggestion(component_id: str) -> tuple[str, str]:
    kind, machine = component_id.split(":", 1)
    return kind, "%s--%s.html.twig" % (kind, machine.replace("_", "-"))


def count(html: str, component_id: str) -> int:
    """How many times the bundle's template output begins on the page."""
    kind, wanted = suggestion(component_id)
    total = 0
    for hook in HOOK.finditer(html):
        if hook.group(1) != kind:
            continue
        rest = html[hook.end():hook.end() + 4000]
        names = SUGGESTIONS.match(rest.lstrip())
        begin = BEGIN.search(rest)
        if names and begin and wanted in NAME.findall(names.group(1)):
            total += 1
    return total


# Shared by both page scripts. A component placed only inside an inactive tab or a closed
# panel is in the page but drawn nowhere; showing its hidden ancestors draws it as it looks
# with that tab selected. Used only when no instance on the page is visible, and marked with
# `data-design-lab-revealed` so the change is never mistaken for the page's own state.
_REVEAL_JS = r"""
  const reveal = (el) => {
    let shown = 0;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.hidden) { a.hidden = false; shown++; }
      if (getComputedStyle(a).display === 'none') {
        a.style.setProperty('display', 'block', 'important'); shown++;
      }
      if (shown) a.setAttribute('data-design-lab-revealed', '');
    }
    return shown;
  };
"""

_TAG_JS = r"""
(() => {
  const id = %(id)s, hook = %(hook)s, wanted = %(wanted)s;
  const SKIP = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
  %(reveal)s
  // The first element each render of the bundle printed: generic wrappers print none of
  // their own, and an embedded block can lead with a <style> or <script>.
  const roots = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  let currentHook = null, names = [];
  for (let c = walker.nextNode(); c; c = walker.nextNode()) {
    const text = c.nodeValue;
    const h = text.match(/^ THEME HOOK: '([\w-]+)' $/);
    if (h) { currentHook = h[1]; names = []; continue; }
    if (text.startsWith(' FILE NAME SUGGESTIONS:')) {
      names = text.match(/[\w-]+\.html\.twig/g) || []; continue;
    }
    if (/BEGIN .*OUTPUT from '/.test(text)) {
      if (currentHook === hook && names.includes(wanted)) {
        const printed = [];
        for (let n = c.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType === Node.COMMENT_NODE && /END .*OUTPUT from '/.test(n.nodeValue)) break;
          if (n.nodeType === Node.ELEMENT_NODE && !SKIP.has(n.tagName)) printed.push(n);
        }
        if (printed.length) roots.push(printed);
      }
      currentHook = null; names = [];
    }
  }
  const drawn = (n) => { const box = n.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  let tagged = 0, revealed = 0;
  for (const printed of roots) {
    const first = printed.find(drawn);
    if (first) { first.setAttribute('data-design-lab-root', id); tagged++; }
  }
  if (!tagged && roots.length) {
    revealed = reveal(roots[0][0]);
    const first = roots[0].find(drawn);
    if (first) { first.setAttribute('data-design-lab-root', id); tagged++; }
  }
  return { tagged, revealed };
})()
"""

_SELECTOR_REVEAL_JS = r"""
(() => {
  const all = [...document.querySelectorAll(%(selector)s)];
  %(reveal)s
  if (!all.length || all.some((el) => el.getBoundingClientRect().height > 4)) {
    return { revealed: 0 };
  }
  return { revealed: reveal(all[0]) };
})()
"""


def tag_script(component_id: str) -> str:
    """Page script marking each root element the bundle's template printed."""
    kind, wanted = suggestion(component_id)
    return _TAG_JS % {"id": json.dumps(component_id), "hook": json.dumps(kind),
                      "wanted": json.dumps(wanted), "reveal": _REVEAL_JS}


def reveal_script(selector: str) -> str:
    """Page script showing the first match's hidden ancestors when no match is visible."""
    return _SELECTOR_REVEAL_JS % {"selector": json.dumps(selector), "reveal": _REVEAL_JS}


def root_selector(component_id: str) -> str:
    return '[data-design-lab-root="%s"]' % component_id
