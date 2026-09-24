# Published voice report

Run `scripts/extract_voice.py --project W --base-url URL` to write `W/voice.json`.
The script reads the public homepage and up to 400 published page aliases from the running site.
Only successful pages enter copy statistics; failed addresses are listed in `corpus`.
`generatedAt` is the extraction time. All other analysis is deterministic for the same pages.

- **Corpus** counts fetched pages, failed addresses, sentences, words, and link or button labels in main content.
- **Evidence** gives the measured value, numerator, denominator, and a short qualification for six headline statistics.
- **Stats** provides five ready-to-render tiles with string `value`, `label`, and `qualifier`: pronoun counts, median sentence length, title-case level-one heading share, verb-first action share, and median reading grade.
- **Positioning** quotes the homepage level-one heading and first two prose paragraphs of at least eight words with its address. If fewer than two qualify, it uses the first two sentences of at least eight words from main content.
- **Vocabulary** lists two- and three-word phrases from paragraphs, list items, and blockquotes. A phrase must occur on at least three pages across at least two page templates (Drupal body bundle when available, otherwise URL pattern). Digits, single letters, and unit abbreviations are excluded. Phrases are counted once per page and ordered by page count, then alphabetically. Capitalised names are listed separately.
- **Name forms** counts the published case, spacing, and punctuation variants of the configured site name.
- **Mechanics** records serial commas, ampersands, numbers, dates, heading case, and action-label case as published.
- **Headlines** shows missing, multiple, repeated, differently cased, and all-capital headings.
- **Calls to action** counts verb-first labels, generic labels, and the most frequent labels.
- **Readability** uses an approximate vowel-group syllable count for Flesch-Kincaid grade; compare pages, rather than treating it as an exact reading level.
- **Search** reports title lengths, repeated titles and descriptions, missing descriptions, and empty or site-name level-one headings.
- **Rules** include an OBSERVED row for each section with data, plus threshold-based WATCH rows. Every row includes a numerator and denominator; examples, when present, have addresses.
- **Inconsistencies** contains watches for site-name variants, duplicate or missing level-one headings, and missing descriptions.

OBSERVED rows report the dominant pronoun direction, most common site-name form and heading case, verb-first action share, median reading grade, and meta-description coverage. A **WATCH** appears when the site name has multiple forms, any page lacks a level-one heading, any heading varies in casing, any level-one heading repeats across pages, generic labels exceed 10% of all labels, median sentence length exceeds 25 words, or any page lacks a meta description. A denominator of zero does not trigger a ratio watch.
