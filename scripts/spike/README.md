# Spikes

Throwaway measurements that answer a question before something gets built
around the answer. Not production code, but kept in the repo because the
*result* matters and re-deriving it later costs more than the file does.

## `resolve_place_ids.py` — does lazy place_id resolution actually work?

The spec's join strategy (§4) is lazy resolution: the first time a catalog
place enters any shortlist, call Google Text Search with its name and
coordinates, keep the returned `place_id` forever. Cost is paid once per
place across the whole user base rather than once per user per query.

**The entire Layer 2 design rests on that working, and it has never been
tested.** This measures it.

```bash
export ELSEWHERE_PG_URL='...'
export GOOGLE_MAPS_API_KEY='...'

./resolve_place_ids.py --dry-run     # see the calls, spend nothing
./resolve_place_ids.py               # 30 calls, well inside the free tier
```

### How to read the result

The sample is **stratified rural vs urban on purpose.** Rural North Texas is
both where matching is hardest and where our catalog beats Google by the
widest margin, so a single blended number would hide the finding.

| Verdict | Meaning |
|---|---|
| `match` | Within 250m and the names agree. Resolution worked. |
| `same_place_different_name` | Right building, different name. Usually a rebrand or a legal-vs-trading name — **probably still a correct resolution**, worth eyeballing. |
| `same_name_different_place` | A chain, matched at the wrong branch. Dangerous: it would attach the wrong `place_id` permanently. |
| `mismatch` | Neither. |
| `no_result` | Google has never heard of it. |

**Above ~85% `match`, the spec holds as written** and unresolvable places stay
the flagged edge case §4 assumes. Below that, `places-proxy` needs a real
fallback and the shortlist has to degrade gracefully rather than treat
resolution failure as exceptional.

Pay particular attention to `same_name_different_place`. A low rate of *no*
answer is recoverable; a wrong answer gets stored permanently and is silent.

### It writes nothing

Deliberately. Even `place_id`, which we are permitted to keep indefinitely,
is only printed — persisting it is `promote`'s job, not a spike's.

### Cost

One Text Search (Pro tier, set by the field mask) per sampled place. Default
30 calls against a 1,000/SKU/month free allowance. The script refuses more
than 200 in one run.

Do not add fields to `FIELD_MASK` out of curiosity. The mask is what selects
the billing SKU; adding `rating` or `priceLevel` moves every call into
Enterprise+Atmosphere.
