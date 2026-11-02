# Model-routing frontier review

`frontier.py` produces the weekly Slopalytics review behind the tier table in Chris's global `AGENTS.md` files. It downloads the Slopalytics bundle, parses the embedded Artificial Analysis dataset as data (no site code is executed), applies `config.json`, and prints a Markdown report with the tier table, per-pool frontiers, eligibility notes, and changes since the last snapshot.

```sh
admin/model-routing/frontier.py --snapshot-dir ~/Vaults/Neurons/Research/Model-Routing/slopalytics/snapshots
python3 -I admin/model-routing/test_frontier.py
```

Exit code 2 means retrieval or extraction failed. Report the failure; never fill in results by hand.

## Method

- **Pools.** Cost is benchmark dollars per task, a proxy for allowance burn that is only comparable within one provider's pool. Frontiers and tier picks are computed per pool. Time per task is comparable across pools and is shown for every pick.
- **Frontier.** A variant is on the frontier when no cheaper variant in the same pool scores higher, which is the rule Slopalytics uses for its Pareto line.
- **Tier pick.** The primary for a tier is the cheapest frontier variant at or above the tier floor. If a stronger frontier variant inside the same band costs at most `upgrade_tolerance` more, it becomes the primary instead. The strongest remaining variant in the band is listed as the step-up.
- **Locked tiers.** Tiers marked `locked` are reported but never chosen by automation.
- **Eligibility.** `denied` families (account policy) and `ignored_families` (no access) are excluded. `effort_ceiling` drops efforts above a cap. A `substitution` routes a capped effort using a higher effort's scores until the capped effort is scored; the report marks those picks.
- **Total cost** is not used. It is per-task cost times the number of tasks a variant ran, and that count varies by variant.

## Comparing pulls

Each run with `--snapshot-dir` saves `<fetchedAt>Z-<sourceHash>.json` (Claude, GPT, and Gemini records, the full family catalog, and the config used) and compares against the previous snapshot:

- identical source hash and config: no material change
- a median intelligence shift of at least `rescale_median_points` across shared variants: possible index rescale, so propose new tier floors rather than comparing scores
- tier-pick changes are recomputed from the previous data under the current config, so they reflect data changes; config changes are reported separately

## Changing the rules

Edit `config.json` through a reviewed change. Add a new family (for example Gemini 4 Carbon) under `families`, and remove the Argon substitution and ceiling when Carbon replaces it. Tier floors are fixed on purpose; the weekly review proposes new floors only after a rescale.
