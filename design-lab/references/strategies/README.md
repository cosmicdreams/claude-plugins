# Strategies

A strategy implements one of the three plug points for one source shape. They compose:
a site picks a component source, a token source and a usage source independently.

## Verified against real repositories (2026-08-31)

| Site | Component source | Count | Config path | Token source |
|---|---|---|---|---|
| AHRI | sitestudio | 146 | `config/sync` | sitestudio-styles (129 entities) |
| Schusterman | sitestudio | 101 | `config/default` | sitestudio-styles (172 entities) |
| PNCB | paragraphs | 43 | `config/default` | sass-sourcemap (113 base tokens) |

The PNCB row was wrong until 2026-08-31. It read `sdc / 13 / config/sync /
css-custom-properties`, and **every one of those four values was an artifact of the
config-directory bug in finding 1**, not an observation about the site. Corrected profile,
each part verified against the repository:

- 43 paragraph types in `config/default`, 11 layout and 32 content
- 13 custom Single Directory Components, of which only **6** are actually invoked by a
  paragraph template - Single Directory Components are a partial rendering layer here,
  not the component source
- tokens recoverable from the committed Sass source map, not from CSS custom properties

Four findings shaped the detector. A naive implementation gets all four wrong.

**1. Existence is not evidence: pick the config directory that holds configuration.**
PNCB ships an **empty** `config/sync` next to the real `config/default`, which holds
1,087 config entities. Probing `config/sync` first and returning it because it exists
found zero paragraph types, so the detector fell through to Single Directory Components
and reported PNCB as a 13-component SDC site. Every downstream fact inherited the error.
Choose the candidate with the most config entities; report the empty ones you skipped.

**2. The configuration directory is not always `config/sync`.** Schusterman uses
`config/default`. Probe for `config/sync`, `config/default`, then `config` - but rank by
content, per finding 1.

**3. Counting `*.component.yml` naively is badly wrong.** Drupal core ships its own
Single Directory Components, and so does contrib. On PNCB a naive find returns 51; only
**13** are the custom theme's. The other 38 are core's system module, the Umami demo
profile, Olivero, and the `sdc_devel` contrib module. On Schusterman a naive find returns
26 and **every single one is core's** - that site has no custom Single Directory
Components at all and is a Site Studio site.

Always prune `core/`, `contrib/`, `vendor/`, `node_modules/` before counting, and report
custom versus vendored separately. A strategy that reports core's components as the
client's design system is worse than useless.

**4. A count is not a mandate. Ask what authors actually place.** PNCB has both 43
paragraph types and 13 Single Directory Components, so a detector that stops at "found
some Single Directory Components" picks the wrong source. Tracing the paragraph templates
settles it: only `accordion`, `accordion_item`, `betty_bot`, `board_member_content`,
`faces_of_certification` and `news_resources` reach a Single Directory Component via
`{% embed 'pncb:...' %}` or `{% include %}`. The other 37 render through plain Twig. Three
Single Directory Components - `split-60-40`, `table`, `text-with-cta` - are defined but
never invoked by the paragraph type of the same name, which is drift worth reporting as a
defect rather than modelling as a component.

When several component sources coexist, `detect` now ranks by count and says so in a note.
Confirm against templates before extracting; the note is a prompt, not a verdict.

## Component sources

| Strategy | Detect by | Maps to the model |
|---|---|---|
| `sitestudio` | `cohesion_elements.cohesion_component.*.yml` | form fields -> fields; `cohSelect` options -> enum; `drop-zone` in canvas -> slots; `showCondition` -> showWhen |
| `sdc` | custom `*.component.yml` | `props.properties.*` -> fields; `enum:` -> enum options; `slots:` -> slots; no conditional equivalent |
| `paragraphs` | `paragraphs.paragraphs_type.*.yml` plus field config | field instances -> fields; `list_string` -> enum; `entity_reference_revisions` -> slots |

Single Directory Components are the cleaner source: props are already typed, enums are
already declared, and slots are explicit. Site Studio requires inference on all three.

### The paragraphs join

One component is spread across three config entity families, and no one file is
sufficient:

```
paragraphs.paragraphs_type.<bundle>.yml      the component
field.field.paragraph.<bundle>.<field>.yml   label, required, target bundles
field.storage.paragraph.<field>.yml          cardinality, and the enum options
```

The trap is that **options live on the storage, labels live on the instance**. Storage is
shared by every bundle reusing that field name, so reading only the instance yields enums
with no options, and reading only the storage yields fields with no labels. `field_icon_1`
on PNCB carries its 10 icon options on the storage entity alone.

`entity_reference_revisions` targeting `paragraph` is a **slot, not a field** - that is
what makes a component a layout container, and it is how `group` is derived. Deriving it
from the name instead fails on real sites in both directions: PNCB's `accordion` and
`hl_hl_news` are containers whose names do not say so, while `detail_table` and
`full_band` sound structural and contain nothing.

Paragraph sites also need **entry points**. A paragraph bundle referenced only from
`field.field.node.<type>.<field>.yml` looks unused inside paragraph-space; PNCB has 7 such
node-level fields, and without them `full_width_row` - the second most placed component on
the site - appears to have no parent at all.

Compared with Site Studio, the variant problem largely evaporates: across 43 PNCB
paragraph types there are exactly **2 enum fields**. Site Studio pushes padding, theme and
layout into `cohSelect` options, which is what drives the combinatorial blowup that
`references/variant-policy.md` exists to contain. A Paragraphs site expresses those in
Twig and CSS instead, so the planner's spacing-enum defaults rarely fire. Do not carry the
Site Studio variant anxiety over to a Paragraphs site.

## Token sources

| Strategy | Detect by | Notes |
|---|---|---|
| `sitestudio-styles` | `cohesion_custom_styles.cohesion_custom_style.*.yml` | Per-breakpoint values under `styles.styles.<bp>.<group>.<prop>.value`. Breakpoints cascade downward: a missing one inherits the next larger. Authoritative - prefer over measurement. |
| `css-custom-properties` | `--*` declarations in theme stylesheets | Needs a rendered page or a compiled stylesheet to resolve real values. **Verify the file is actually loaded** - see the warning below |
| `sass-sourcemap` | `*.css.map` with `sourcesContent` | Recovers the original `$variables` from committed build output when the Sass sources live in another repository. Configuration-grade provenance |
| `tailwind` | `tailwind.config.*` | Scale is declarative; colour aliasing needs resolving |

Token source is independent of component source. A Single Directory Component site has no
tokens in configuration at all.

### Count custom properties only in stylesheets the theme loads

The `css-custom-properties` probe is the easiest one to get wrong, because the largest
pile of custom properties in a repository is frequently not the design system.

On PNCB the active library loads `build/css/pncb-generated.css`, which declares **12**
custom properties - no usable token layer. Meanwhile `components/incoming/global.css`
declares **69**, and they are Catppuccin palette entries and Tailwind scaffolding from an
unrelated experiment. It is not referenced by `pncb.libraries.yml` and never reaches a
browser. A file-count heuristic picks the 69 and imports a palette the site has never
rendered.

Cross-check candidate stylesheets against `*.libraries.yml` before believing them.

### Prefer the source map to measurement

PNCB commits no `.scss` at all - only compiled CSS. That looks like it forces measurement,
which `references/model.md` ranks below configuration. It does not: `pncb-generated.css.map`
embeds all 80 original stylesheets in `sourcesContent`, so `pncb/base/_colors.scss` and its
39 named variables are recoverable straight from the repository, with a real name and a
citable reference for every value.

Validated against the PNCB Figma library: 23 of its 28 colour variables resolve to a named
Sass variable. The remaining 5 are build-time `lighten()` results or measured values and
have **no configuration provenance** - exactly the distinction `provenance` exists to
record. Recovering the breakpoints matters as much: 470 / 910 / 911 / 1180 px come out of
`_grid-settings.scss` as declarations rather than guesses.
