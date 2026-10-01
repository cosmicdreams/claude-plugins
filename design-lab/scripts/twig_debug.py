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


END = re.compile(r"<!-- [^\n]*END [^\n]*OUTPUT from '([^']+)' -->")
EVENT = re.compile(r"<!-- THEME HOOK: '([\w-]+)' -->|<!-- FILE NAME SUGGESTIONS:(.*?)-->|"
                   r"<!-- [^\n]*(BEGIN|END) [^\n]*OUTPUT from '([^']+)' -->", re.S)


def renders_within(html: str, parent_id: str, child_ids) -> dict:
    """How many times each child bundle's own template runs inside the parent's renders.

    Twig debug brackets every template's output with BEGIN and END comments, so templates
    nest like tags. A child whose count is 0 while the parent rendered is printed by the
    parent's template from field values: data, not a rendered component."""
    targets = {cid: suggestion(cid) for cid in [parent_id, *child_ids]}
    counts = {cid: 0 for cid in child_ids}
    parents, stack, hook, names = 0, [], None, []
    for m in EVENT.finditer(html):
        if m.group(1):
            hook, names = m.group(1), []
        elif m.group(2) is not None:
            names = NAME.findall(m.group(2))
        elif m.group(3) == "BEGIN":
            mine = {cid for cid, (kind, wanted) in targets.items() if kind == hook and wanted in names}
            if parent_id in mine:
                parents += 1
            if any(parent_id in frame for frame in stack):
                for cid in mine - {parent_id}:
                    counts[cid] += 1
            stack.append(mine)
            hook, names = None, []
        elif m.group(3) == "END" and stack:
            stack.pop()
    return {"parentRenders": parents, "children": counts}


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
  const id = %(id)s, hook = %(hook)s, wanted = %(wanted)s, attr = %(attr)s, mayReveal = %(reveal_on)s;
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
    if (first) { first.setAttribute(attr, id); tagged++; }
  }
  if (!tagged && roots.length && mayReveal) {
    revealed = reveal(roots[0][0]);
    const first = roots[0].find(drawn);
    if (first) { first.setAttribute(attr, id); tagged++; }
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


def tag_script(component_id: str, attribute: str = "data-design-lab-root", reveal: bool = True) -> str:
    """Page script marking each root element the bundle's template printed. Child bundles
    are tagged with `data-design-lab-child` and never revealed, so the parent stays as drawn."""
    kind, wanted = suggestion(component_id)
    return _TAG_JS % {"id": json.dumps(component_id), "hook": json.dumps(kind),
                      "wanted": json.dumps(wanted), "reveal": _REVEAL_JS,
                      "attr": json.dumps(attribute), "reveal_on": "true" if reveal else "false"}


def child_tag_scripts(child_ids) -> str:
    """Tag the roots of every child bundle a parent's slots accept, for nesting instances."""
    return "".join("%s;\n" % tag_script(cid, "data-design-lab-child", reveal=False).strip()
                   for cid in child_ids if ":" in cid and not cid.startswith("sdc."))


def reveal_script(selector: str) -> str:
    """Page script showing the first match's hidden ancestors when no match is visible."""
    return _SELECTOR_REVEAL_JS % {"selector": json.dumps(selector), "reveal": _REVEAL_JS}


def root_selector(component_id: str) -> str:
    return '[data-design-lab-root="%s"]' % component_id
