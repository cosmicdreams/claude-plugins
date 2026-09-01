# Default variants

Figma uses the **first variant in the set** as the instance default: that is what a designer
gets when they drag the component out of the Assets panel. Place the wrong one first and the
library previews as blank or off-brand. So "which variant is the default" is a question with
a real consequence, and it has an evidence-based answer rather than a taste-based one.

## The default is usually already in the configuration

Verified 2026-09-01 across the three repositories. The two component sources behave very
differently, and treating them alike gets one of them wrong.

### Site Studio — declared, and usually present

The default sits in the field's **sibling model object**, at:

```
json_values.model.<field_uuid>.value
```

Not `defaultValue`, not `activeValue`, not `defaults`. Across 1,858 component form fields in
247 components (AHRI 146 plus Schusterman 101):

| State | Count |
|---|---|
| `model.value` populated | 1,485 |
| present but empty | 173 |
| absent | 200 |

So roughly **four fields in five carry a declared default**. Read it; do not infer one.

`settings.defaultActive` is a decoy. It occurs 131 times, always `true`, always on
`cohFileBrowser` settings — it is widget metadata and has nothing to do with the field's
content default.

**Select options carry no default marker.** All 4,732 options across 858 `cohSelect` fields
expose only `label`, `value` and layout keys — never `default` or `selected`. The selected
option is identified solely by matching the sibling `model.value`. An extractor that looks
for a marker inside the option list will find nothing and wrongly conclude there is no
default.

### Paragraphs — declared, and almost never present

```
default_value[0].value          # populated in 2 of 102 PNCB field instances
default_value_callback          # empty in all 102
```

`list_string` allowed values on the storage entity carry no default marker either.

So on a Paragraphs site the unset state is, in practice, **always** the default. Do not go
looking for declared defaults that are not there; record `defaultSource: "unset"` and move
on.

## The rule

Apply in order, and record which one fired in `defaultSource`:

1. **`declared`** — the configuration states a default. Use it. This covers most Site Studio
   fields and almost no Paragraphs fields.
2. **`unset`** — no default declared, so the real default is the no-token, no-class state.
   Name that variant `Default` (for a theme axis) or `None` (for a spacing axis) and place it
   first. It is a legitimate variant, not an absence: AHRI's `cpt_text` theme axis is
   literally `Default, Light Blue Black, Dark Blue White, Medium Blue Black`.
3. **`observed`** — optional override. When `design-lab:usage` has scanned the site, the
   configuration a component is *most often placed in* is a better library default than the
   declared one, because it is the shape a designer will reach for. Use it only when the
   usage scan covered enough pages to mean something, and always record that it overrode a
   declared value.

Recording which rule fired is what makes the choice arguable later. A default that came from
rule 3 on a twelve-page scan deserves less trust than one that came from rule 1, and nothing
downstream can tell the difference unless the record says so.

## Order the axes too

Figma shows the first variant property as the primary control. Put the axis a designer picks
first — almost always the theme or colour scheme — first in the set, and keep the option
order the source declares. Alphabetising an option list that the source deliberately ordered
small-medium-large is a small act of vandalism.
