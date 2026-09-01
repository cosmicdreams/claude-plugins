# The universal component model

Every extractor writes this shape. Every renderer reads it. Nothing else crosses the
boundary. If a source concept does not fit here, extend this document first — do not
let a renderer reach back into source-specific data.

## Why an intermediate at all

Writing source straight into Figma produces a one-shot script: it cannot be re-run,
cannot be diffed against the source later, and cannot feed anything but Figma. The model
is what makes drift detection, documentation and Code Connect possible from the same
extraction.

## Three independent plug points

These vary separately. Do not assume one implies another.

| Plug point | Answers | Examples |
|---|---|---|
| component source | what components exist and what fields they take | Site Studio, Single Directory Components, Paragraphs, Storybook |
| token source | what the colours, spacing and type ramps are | Site Studio custom styles, CSS custom properties, Tailwind config, design token JSON |
| usage source | how often each component is actually placed | database placement query, template grep, analytics |

A Single Directory Component site has no tokens in configuration — they live in stylesheets.
A Site Studio site keeps both in configuration. Conflating the axes forces one site down
another's path.

## components.json

```jsonc
{
  "generatedAt": "ISO-8601",
  "source": { "strategy": "sitestudio|sdc|...", "root": "/abs/path", "version": "..." },
  "components": [
    {
      "id": "cpt_text",                  // machine name, stable key
      "label": "Text",                   // human label; becomes the Figma component name
      "description": "...",
      "group": "AHRI General Components",
      "category": "Content",             // collapsed group; becomes the Figma page
      "aliases": ["copy", "rich text", "wysiwyg"],  // search synonyms - see findability.md
      "sourceRef": "config/sync/....yml", // where it came from, for drift and citation
      "fields": [
        {
          "name": "theme",               // machine name
          "label": "Theme",
          "kind": "enum|text|richtext|boolean|color|media|number|reference|hidden|help",
          "required": false,
          "default": "",
          "options": [ { "value": "coh-style-...", "label": "Colour scheme ..." } ],
          "showWhen": "raw source expression, or null",
          "appliesToken": "coh-style-padding-small", // when the option IS a token
          "defaultSource": "declared|unset|observed"  // see references/defaults.md
        }
      ],
      "slots": [ { "name": "content", "label": "Content", "accepts": "any|[ids]" } ],
      "usage": {
        "placements": 1304,              // LOWER BOUND over the pages actually scanned
        "structuralRefs": 77,
        "tier": "high",
        "examples": [                    // verified, never claimed - see below
          { "url": "https://www.ahrinet.org/certification",
            "marker": "coh-ce-cpt_text-",
            "instancesOnPage": 3,
            "status": 200, "anonymous": true, "verifiedAt": "2026-09-01" }
        ]
      },
      "defects": [ { "kind": "dangling-field-ref", "detail": "...", "evidence": "..." } ]
    }
  ]
}
```

### Field kinds

Normalise to this closed set. Source widget names (`cohSelect`, `cohWysiwyg`,
`form-input-hidden`) do not leak past the extractor.

`enum` `text` `richtext` `boolean` `color` `media` `number` `reference` `hidden` `help`

### `appliesToken` is the important one

When an enum option's value is a design token rather than a visual choice — every
`coh-style-padding-*` value, for instance — record it here. The renderer uses this to
decide **bound variable, not variant axis**, which is the single decision that keeps
variant counts sane. See `references/variant-policy.md`.

## tokens.json

```jsonc
{
  "modes": ["Desktop 1440", "Tablet 905", "Mobile 400"],
  "colors":  [ { "name": "Brand blue", "hex": "#005CB9", "tags": ["Blue"],
                 "figmaName": "color/brand/blue",
                 "codeName": "--sfp-color-brand-blue" } ],
  "schemes": [ { "name": "dark-blue-white", "surface": "Brand blue", "text": "White",
                 "heading": "White", "padding": "$spacing-small" } ],
  "spacing": [ { "name": "pad/small", "values": [32, 24, 24],
                 "sourceClasses": [".coh-style-padding-small", ".coh-style-padding-top-small"] } ],
  "type":    [ { "role": "body", "family": "Nunito Sans", "style": "Regular",
                 "size": 20, "lineHeight": 32, "scalesByBreakpoint": false } ]
}
```

### `codeName` is how the library stays consistent with the code

Every token records the identifier it has in the codebase, verbatim, alongside the name it
will carry in Figma. It becomes the Figma variable's code syntax, which is what a developer
sees in Dev Mode. `codeName` is **not always a Cascading Style Sheets custom property** - on
a Site Studio site it is a generated class, on PNCB it is a Sass variable - and it is `null`
when the codebase genuinely has no identifier for that value. Never invent a plausible one.
Full rules in `references/tokens-and-variables.md`.

`scalesByBreakpoint: false` is meaningful. If type does not scale, the type collection
gets ONE mode. Giving it breakpoint modes implies a responsive ramp that does not exist.

## Provenance

Every numeric value carries where it came from. Never silently mix.

```jsonc
{ "value": 32, "provenance": { "kind": "config", "ref": "cohesion_custom_style.a56b4c76" } }
{ "value": 40, "provenance": { "kind": "measured", "url": "https://.../certification",
                               "breakpoint": 1440, "date": "2026-08-31" } }
{ "value": 24, "provenance": { "kind": "derived", "from": "pad/small" } }
```

Configuration beats measurement for tokens. A single rendered instance conflates sources:
on AHRI, a text component rendered 40px horizontal padding that looked like its padding
field but was actually its colour scheme applying `padding-equal: $spacing-small`.
Configuration separates what measurement blends together.

## Verified example addresses

`usage.examples` records where a component was **observed rendering**, never where a
document claims it renders. The distinction is not pedantic: the specification file shipped
with the AHRI library listed live example paths of which two were behind login and at least
one named a page the component was not on.

Three conditions, all required:

- fetched **anonymously**, with the status code recorded, because a page a designer cannot
  open is not an example
- carries the markup marker, so the instance is findable on a long page
- carries `verifiedAt`, because a content edit can remove the last instance at any time

`scripts/find_examples.py` produces these by crawling the public site. A component with no
anonymous example gets an empty list and a stated reason - that is a real finding about the
site, and it is also the reason four of the fourteen built AHRI components could only be
derived from tokens rather than measured.

**Placement counts are a lower bound.** They cover only the pages scanned. Never present
one as a site total unless the whole sitemap was walked, and record `pagesScanned` alongside
so the number can be interpreted.
