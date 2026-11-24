"""WCAG 2.1 Level A and AA success criteria, and what each kind of evidence can decide.

This table is the completeness model. Automated evidence can show that a criterion fails.
It can show a pass only where the criterion is listed in DECISIVE_CHECKS,
STANDARD_PASS or a site-wide axe pass rule. Everything else waits for a person.
"""

PRINCIPLES = {"1": "Perceivable", "2": "Operable", "3": "Understandable", "4": "Robust"}

GUIDELINES = {
    "1.1": "Text Alternatives", "1.2": "Time-based Media", "1.3": "Adaptable", "1.4": "Distinguishable",
    "2.1": "Keyboard Accessible", "2.2": "Enough Time", "2.3": "Seizures and Physical Reactions",
    "2.4": "Navigable", "2.5": "Input Modalities", "3.1": "Readable", "3.2": "Predictable",
    "3.3": "Input Assistance", "4.1": "Compatible",
}

# (id, name, level, anchor in https://www.w3.org/TR/WCAG21/)
CRITERIA = [
    ("1.1.1", "Non-text Content", "A", "non-text-content"),
    ("1.2.1", "Audio-only and Video-only (Prerecorded)", "A", "audio-only-and-video-only-prerecorded"),
    ("1.2.2", "Captions (Prerecorded)", "A", "captions-prerecorded"),
    ("1.2.3", "Audio Description or Media Alternative (Prerecorded)", "A", "audio-description-or-media-alternative-prerecorded"),
    ("1.2.4", "Captions (Live)", "AA", "captions-live"),
    ("1.2.5", "Audio Description (Prerecorded)", "AA", "audio-description-prerecorded"),
    ("1.3.1", "Info and Relationships", "A", "info-and-relationships"),
    ("1.3.2", "Meaningful Sequence", "A", "meaningful-sequence"),
    ("1.3.3", "Sensory Characteristics", "A", "sensory-characteristics"),
    ("1.3.4", "Orientation", "AA", "orientation"),
    ("1.3.5", "Identify Input Purpose", "AA", "identify-input-purpose"),
    ("1.4.1", "Use of Color", "A", "use-of-color"),
    ("1.4.2", "Audio Control", "A", "audio-control"),
    ("1.4.3", "Contrast (Minimum)", "AA", "contrast-minimum"),
    ("1.4.4", "Resize Text", "AA", "resize-text"),
    ("1.4.5", "Images of Text", "AA", "images-of-text"),
    ("1.4.10", "Reflow", "AA", "reflow"),
    ("1.4.11", "Non-text Contrast", "AA", "non-text-contrast"),
    ("1.4.12", "Text Spacing", "AA", "text-spacing"),
    ("1.4.13", "Content on Hover or Focus", "AA", "content-on-hover-or-focus"),
    ("2.1.1", "Keyboard", "A", "keyboard"),
    ("2.1.2", "No Keyboard Trap", "A", "no-keyboard-trap"),
    ("2.1.4", "Character Key Shortcuts", "A", "character-key-shortcuts"),
    ("2.2.1", "Timing Adjustable", "A", "timing-adjustable"),
    ("2.2.2", "Pause, Stop, Hide", "A", "pause-stop-hide"),
    ("2.3.1", "Three Flashes or Below Threshold", "A", "three-flashes-or-below-threshold"),
    ("2.4.1", "Bypass Blocks", "A", "bypass-blocks"),
    ("2.4.2", "Page Titled", "A", "page-titled"),
    ("2.4.3", "Focus Order", "A", "focus-order"),
    ("2.4.4", "Link Purpose (In Context)", "A", "link-purpose-in-context"),
    ("2.4.5", "Multiple Ways", "AA", "multiple-ways"),
    ("2.4.6", "Headings and Labels", "AA", "headings-and-labels"),
    ("2.4.7", "Focus Visible", "AA", "focus-visible"),
    ("2.5.1", "Pointer Gestures", "A", "pointer-gestures"),
    ("2.5.2", "Pointer Cancellation", "A", "pointer-cancellation"),
    ("2.5.3", "Label in Name", "A", "label-in-name"),
    ("2.5.4", "Motion Actuation", "A", "motion-actuation"),
    ("3.1.1", "Language of Page", "A", "language-of-page"),
    ("3.1.2", "Language of Parts", "AA", "language-of-parts"),
    ("3.2.1", "On Focus", "A", "on-focus"),
    ("3.2.2", "On Input", "A", "on-input"),
    ("3.2.3", "Consistent Navigation", "AA", "consistent-navigation"),
    ("3.2.4", "Consistent Identification", "AA", "consistent-identification"),
    ("3.3.1", "Error Identification", "A", "error-identification"),
    ("3.3.2", "Labels or Instructions", "A", "labels-or-instructions"),
    ("3.3.3", "Error Suggestion", "AA", "error-suggestion"),
    ("3.3.4", "Error Prevention (Legal, Financial, Data)", "AA", "error-prevention-legal-financial-data"),
    ("4.1.1", "Parsing", "A", "parsing"),
    ("4.1.2", "Name, Role, Value", "A", "name-role-value"),
    ("4.1.3", "Status Messages", "AA", "status-messages"),
]
IDS = [c[0] for c in CRITERIA]
assert len(CRITERIA) == 50 and len(set(IDS)) == 50

# axe-core rules tagged with a WCAG 2.0/2.1 A or AA success criterion (axe-core 4.10 tags).
# A violation of one of these is a failure of each listed criterion. Screaming Frog's
# Guidelines column wins when it names criteria; this map is the fallback.
AXE_RULE_SC = {
    "area-alt": ["2.4.4", "4.1.2"], "aria-allowed-attr": ["4.1.2"], "aria-braille-equivalent": ["4.1.2"],
    "aria-command-name": ["4.1.2"], "aria-conditional-attr": ["4.1.2"], "aria-deprecated-role": ["4.1.2"],
    "aria-hidden-body": ["4.1.2"], "aria-hidden-focus": ["4.1.2"], "aria-input-field-name": ["4.1.2"],
    "aria-meter-name": ["1.1.1"], "aria-progressbar-name": ["1.1.1"], "aria-prohibited-attr": ["4.1.2"],
    "aria-required-attr": ["4.1.2"], "aria-required-children": ["1.3.1"], "aria-required-parent": ["1.3.1"],
    "aria-roles": ["4.1.2"], "aria-toggle-field-name": ["4.1.2"], "aria-tooltip-name": ["4.1.2"],
    "aria-valid-attr-value": ["4.1.2"], "aria-valid-attr": ["4.1.2"], "autocomplete-valid": ["1.3.5"],
    "avoid-inline-spacing": ["1.4.12"], "blink": ["2.2.2"], "button-name": ["4.1.2"], "bypass": ["2.4.1"],
    "color-contrast": ["1.4.3"], "definition-list": ["1.3.1"], "dlitem": ["1.3.1"], "document-title": ["2.4.2"],
    "duplicate-id-aria": ["4.1.2"], "form-field-multiple-labels": ["3.3.2"], "frame-focusable-content": ["2.1.1"],
    "frame-title-unique": ["4.1.2"], "frame-title": ["4.1.2"], "html-has-lang": ["3.1.1"],
    "html-lang-valid": ["3.1.1"], "html-xml-lang-mismatch": ["3.1.1"], "image-alt": ["1.1.1"],
    "input-button-name": ["4.1.2"], "input-image-alt": ["1.1.1", "4.1.2"], "label": ["4.1.2"],
    "label-content-name-mismatch": ["2.5.3"], "link-in-text-block": ["1.4.1"], "link-name": ["2.4.4", "4.1.2"],
    "list": ["1.3.1"], "listitem": ["1.3.1"], "marquee": ["2.2.2"], "meta-refresh": ["2.2.1"],
    "meta-viewport": ["1.4.4"], "nested-interactive": ["4.1.2"], "no-autoplay-audio": ["1.4.2"],
    "object-alt": ["1.1.1"], "role-img-alt": ["1.1.1"], "scrollable-region-focusable": ["2.1.1"],
    "select-name": ["4.1.2"], "server-side-image-map": ["2.1.1"], "svg-img-alt": ["1.1.1"],
    "td-headers-attr": ["1.3.1"], "th-has-data-cells": ["1.3.1"], "valid-lang": ["3.1.2"],
    "video-caption": ["1.2.2"],
}

# Best-practice axe rules: never a failure, only a lead for a reviewer on the listed criterion.
BEST_PRACTICE_LEADS = {
    "accesskeys": "2.1.4", "tabindex": "2.4.3", "skip-link": "2.4.1", "region": "1.3.1",
    "landmark-one-main": "1.3.1", "page-has-heading-one": "1.3.1", "heading-order": "1.3.1",
    "empty-heading": "2.4.6", "empty-table-header": "1.3.1", "label-title-only": "3.3.2",
    "frame-tested": "4.1.2", "presentation-role-conflict": "4.1.2", "meta-viewport-large": "1.4.4",
    "scope-attr-valid": "1.3.1", "table-duplicate-name": "1.3.1", "aria-text": "4.1.2",
    "aria-treeitem-name": "4.1.2", "aria-dialog-name": "4.1.2", "landmark-unique": "1.3.1",
    "identical-links-same-purpose": "2.4.4",
}

# Criteria a site-wide axe pass decides on its own: no violation of these rules on any
# crawled page, with axe confirmed to have run on every page.
AXE_SITEWIDE_PASS = {
    "3.1.1": ("html-has-lang", "html-lang-valid", "html-xml-lang-mismatch"),
}

# Criteria a passing Playwright check decides: at least one check row for every
# representative page in every browser, all of them passing, none inconclusive.
DECISIVE_CHECKS = {
    "1.3.4": "Content works in portrait and landscape",
    "2.1.2": "Focus can always leave every component with Tab and Shift+Tab",
    "2.1.4": "No single-character key shortcut fires",
    "1.4.12": "No text clipped with WCAG text spacing applied",
}

# Criteria decided by the standard itself.
STANDARD_PASS = {"4.1.1": "Always met for HTML and XML under the WCAG 2.1 errata (2023)"}

# Not applicable only when the full-crawl inventory proves the content is absent.
# Each entry: inventory columns that must all be zero on every crawled page.
NOT_APPLICABLE_WHEN_ABSENT = {
    "1.2.1": ["video", "audio", "media_iframe"],
    "1.2.2": ["video", "media_iframe"],
    "1.2.3": ["video", "media_iframe"],
    "1.2.4": ["video", "media_iframe"],
    "1.2.5": ["video", "media_iframe"],
    "1.4.2": ["audio", "video", "autoplay"],
    "1.3.5": ["personal_input"],
    "3.3.1": ["input"],
    "3.3.3": ["input"],
}
ABSENT_PHRASE = {
    "video": "video", "audio": "audio", "media_iframe": "embedded media player", "autoplay": "autoplaying media",
    "personal_input": "personal-data input", "input": "form input",
}

# Steps a person follows when automation cannot decide.
STEPS = {
    "1.1.1": "Review each image's alt text in context; decorative images have empty alt, informative ones an equivalent",
    "1.2.1": "For each audio-only or video-only file, confirm a transcript or equivalent",
    "1.2.2": "Play each prerecorded video; captions are present and accurate",
    "1.2.3": "For each video, confirm audio description or a full text alternative",
    "1.2.4": "For each live stream, confirm live captions",
    "1.2.5": "For each prerecorded video, confirm audio description of visual information",
    "1.3.1": "Check headings, lists, tables and form groups with a screen reader; structure matches what is seen",
    "1.3.2": "Read each template with a screen reader; reading order matches the visual order",
    "1.3.3": "Read instructions; none rely only on shape, size, location or sound",
    "1.3.4": "Rotate a phone to landscape and portrait on each template; content works in both",
    "1.3.5": "Check personal-data fields (name, email, phone, address) carry the right autocomplete values",
    "1.4.1": "Find links, states, errors and charts that use color; confirm a second cue",
    "1.4.2": "Confirm any audio that plays for more than 3 seconds can be paused or muted",
    "1.4.3": "Measure text over images and gradients the scanner could not resolve; confirm 4.5:1 (3:1 for large text)",
    "1.4.4": "Zoom text to 200% in the browser; nothing is cut off or overlaps",
    "1.4.5": "Find images that contain text; confirm the text is real text or the image is essential",
    "1.4.10": "At 320 px wide, use each template; no two-dimensional scrolling except tables, maps and diagrams",
    "1.4.11": "Measure focus rings, input borders, icons and chart parts against 3:1",
    "1.4.12": "Apply the WCAG text-spacing bookmarklet; nothing is clipped or overlaps",
    "1.4.13": "Hover and focus tooltips and menus; dismissible with Escape, hoverable, and persistent",
    "2.1.1": "Operate every menu, tab, filter, map, carousel and form with the keyboard alone",
    "2.1.2": "Tab and Shift+Tab into and out of every widget, embed and dialog",
    "2.1.4": "Press single letter and number keys on each template; nothing fires unexpectedly",
    "2.2.1": "Find time limits (sessions, rotating alerts); confirm the user can turn off, adjust or extend them",
    "2.2.2": "Find carousels, animations and auto-updating content; confirm pause, stop or hide controls",
    "2.3.1": "Look for flashing content; nothing flashes more than three times per second",
    "2.4.1": "Confirm a working skip link or landmarks let keyboard users bypass repeated blocks",
    "2.4.2": "Read each template's title; it describes the page's topic or purpose",
    "2.4.3": "Tab through each template; focus moves in a logical order and returns from dialogs",
    "2.4.4": "Read each link's text with its context; its purpose is clear",
    "2.4.5": "Confirm each page is reachable two ways (navigation, search, site map, related links)",
    "2.4.6": "Read headings and form labels; each describes its topic or purpose",
    "2.4.7": "Tab through each template; every focused element shows a visible indicator",
    "2.5.1": "Find multipoint or path gestures (maps, sliders, carousels); confirm a single-pointer alternative",
    "2.5.2": "Confirm actions fire on release, not on press, or can be aborted",
    "2.5.3": "Compare visible labels with accessible names on buttons and links; the name contains the label",
    "2.5.4": "Confirm no feature is triggered by shaking or tilting the device, or that it can be disabled",
    "3.1.1": "Confirm the page language is declared and correct",
    "3.1.2": "Find passages in other languages; confirm lang attributes",
    "3.2.1": "Focus each control; nothing changes context on focus alone",
    "3.2.2": "Change each select, radio and filter; no unexpected context change",
    "3.2.3": "Compare navigation across templates; same relative order everywhere",
    "3.2.4": "Compare repeated components (search, alerts, cards, icons); same names and labels everywhere",
    "3.3.1": "Submit each form with errors; errors are identified and described in text",
    "3.3.2": "Check every form field has a visible label or instructions",
    "3.3.3": "Confirm error messages suggest a fix where one is known",
    "3.3.4": "For legal, financial or data-changing forms, confirm review, correct or cancel before submission",
    "4.1.2": "Inspect custom widgets with a screen reader; name, role and state are announced",
    "4.1.3": "Trigger search results, filters, cart updates and errors; status changes are announced without moving focus",
}
assert set(STEPS) | set(STANDARD_PASS) == set(IDS), sorted(set(IDS) - set(STEPS) - set(STANDARD_PASS))

AXE_SEVERITY = {"critical": "Critical", "serious": "High", "moderate": "Medium", "minor": "Low"}
SEVERITY_ORDER = ["Critical", "High", "Medium", "Low"]
