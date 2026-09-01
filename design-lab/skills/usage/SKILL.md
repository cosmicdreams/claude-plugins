---
name: usage
description: >
  Crawl the public site to find where each component actually renders — verified anonymous
  page addresses plus placement counts and usage tiers — and merge them into
  components.json. Run after design-lab:inventory and before design-lab:plan, because tier
  decides what gets built. Not for extracting components (design-lab:inventory).
---

# Find verified example addresses

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/find_examples.py https://www.ahrinet.org \
    --strategy sitestudio --components components.json --merge > components.enriched.json
```

`--strategy paragraphs` for a Paragraphs site. `--urls FILE` skips the sitemap when you
already have a page list. `--limit` and `--delay` control crawl volume; be polite on a
client's production site.

## Verified, never claimed

The specification shipped with the AHRI library listed live example paths. Two were behind
login and at least one named a page the component was not on. So this skill does not read
claimed addresses — it fetches pages **anonymously** and records the status code that proves
a designer can open them.

A component with no anonymous example gets an empty list and a stated reason. That is a real
finding, not a failure: it is exactly why four of the fourteen built AHRI components could
only be derived from tokens rather than measured against a live instance.

## Two markers, and conflating them is the trap

Site Studio stamps `coh-ce-<name>-<hash>` on **every styled element of a component
template** — Schusterman's `cpt_content_card_0` carries eight different hashes across its
root, image, text wrapper, heading and paragraph. The hash identifies an element of the
definition, not a placement. Counting distinct hashes reports a number that never changes
however often the component is placed, and counting raw matches inflates one site footer
into thirty-five placements.

`coh-component-instance-<uuid>` is the per-placement identifier. The script pairs the two
within a single class attribute and counts distinct instance uuids.

Paragraphs are simpler: `paragraph--type--<bundle>` is emitted once per rendered paragraph,
so occurrences are already placements. Note that Drupal's `clean_class` filter converts
underscores to hyphens, so the extracted name needs converting back before it matches a
bundle machine name.

**Paragraph counts can undercount.** PNCB's generic `paragraph.html.twig` builds the bundle
class but does not itself emit a wrapper. Templates extending `paragraph--component.html.twig`
emit it reliably; a custom template that omits that base wrapper renders no bundle marker at
all, so its component is invisible to this scan. Treat a paragraph bundle reported as
unobserved as a question about its template, not as proof it is unused.

## Read the output carefully

**Placements are a lower bound** over `pagesScanned`. Never quote one as a site total unless
the whole sitemap was walked.

**Check `addressesRehostedCount`.** Sitemaps often advertise the hosting origin rather than
the public hostname — AHRI's returns `ahridrupalhosting.prod.acquia-sites.com`. The script
rewrites addresses onto the host you asked for and tells you how many it moved.

**`componentsUnseen` is the interesting list.** A component in `components.json` that never
appears on any scanned page is either genuinely unused, or lives only behind login. Decide
which before letting `tier` gate the build.

## Next

`design-lab:plan`, which uses `tier` to scope what is worth building.
