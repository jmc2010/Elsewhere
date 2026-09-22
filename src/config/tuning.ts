/**
 * Every tunable value in the product, in one place.
 *
 * ----------------------------------------------------------------------------
 * READ THIS BEFORE USING ANY NUMBER BELOW
 * ----------------------------------------------------------------------------
 * These are starting values, not findings. They are guesses that let the first
 * build run. Every one of them is expected to move once there is real behaviour
 * to tune against. They are not designed constants, they carry no precision the
 * data supports, and no screen should hard-code one.
 *
 * That is the entire reason this module exists (design spec §15). If a value
 * from here ever gets copied into a component, the ability to change it
 * without touching a screen is gone, and so is the reason it was written down.
 *
 * Each knob records what it is meant to be tuned *against*, because a number
 * with no success metric cannot be tuned, only argued about.
 */

export const tuning = {
  /**
   * The catalog pool: what the ranker gets to choose from.
   *
   * Both are passed to `catalog_search` on every call. Neither has a default
   * in the function signature on purpose -- a default of "25 rows within 20
   * miles" is a product decision, and a product decision living in a function
   * signature needs a migration to change.
   *
   * `radiusMiles` is a GATE and nothing else. Distance does not order the
   * pool and does not truncate it (spec §3): measured, eight Valley View
   * results span 0.1-0.2 miles and ten Dallas places sit at 0.0, so it
   * discriminates nothing within a town.
   *
   * `poolLimit` wants to be large. Anything outside the pool can never be
   * recommended however good it is, and the pool costs nothing -- it is Layer
   * 1 only, zero Google calls. The Google hydration budget is a separate and
   * much smaller number enforced in places-proxy.
   *
   * Measured at these values: Valley View 21 of 21, Gainesville 163 of 163 --
   * both complete, so rural is never truncated. Downtown Dallas has 3,982
   * eligible and truncates to 200.
   *
   * Tune against: how often a place the ranker would have picked was outside
   * the pool. In dense areas that is currently unknowable, which is why
   * ranking moves into catalog_search when Dallas pool sizes get
   * uncomfortable -- see docs/STATUS.md.
   */
  catalog: {
    poolLimit: 200,
    radiusMiles: 5,
    /** 5 miles in metres, which is what catalog_search takes. */
    radiusMeters: 8047,
    /**
     * Whether to include rows whose name says they are not somewhere you eat
     * or drink. The shortlist says no.
     *
     * This lives here rather than in the screen for the same reason the
     * radius and the limit do: what the catalog returns is a product
     * decision, and a product decision embedded in a component needs a code
     * change to move. The flag itself stays evidence -- catalog_search
     * defaults to including them, so a correction flow can still see them.
     */
    includeNonDestinations: false,
  },

  /**
   * Rural exhausted (§10).
   *
   * When every nearby place already has a verdict, the screen offers one way
   * out: the nearest town with more places than are left here. These bound
   * that search.
   *
   * `maxTownMiles` is how far is still a reasonable offer rather than an
   * absurd one -- past it, widening the radius where you already are is the
   * more honest suggestion. Tune against: whether the offer gets taken.
   */
  exhausted: {
    maxTownMiles: 30,
    /** If no town qualifies, widen to this instead. */
    widenedRadiusMiles: 15,
  },

  /**
   * How long a place stays suppressed after you have been, by verdict.
   * Suppression is not punishment -- it is the anti-rut mechanism, and it is
   * the thing that separates this product from taste profiles built on
   * transaction frequency, which reinforce the rut instead.
   */
  recency: {
    /** Verdict `It was fine`. Tune against: repeat-visit rate. */
    fineDays: 14,
    /** A visit with no verdict recorded. Tune against: nothing yet specified. */
    unratedDays: 30,
    /**
     * Verdict `known` gets NO recency suppression, and that is deliberate
     * rather than an omission -- there is no number here to tune.
     *
     * `known` comes from the cold-start recognition grid and carries no date:
     * "I have been here at some point". Any suppression window applied to it
     * would be invented, and would go wrong in both directions at once --
     * hiding a place last visited in 2019, and failing to hide one visited
     * last week.
     *
     * What `known` DOES suppress is novelty. It is emphatically not new to
     * you, and surfacing it as a discovery is the one thing the grid exists
     * to prevent. See `novelty` below: a `known` place counts toward the
     * `known` side of the ratio and can never count toward `new`.
     */
    /** Verdict `Again` -- longer, because a place you loved is the easiest rut to fall into. Tune against: re-lock-in rate. */
    againCooldownDays: 45,
  },

  /**
   * Cold start (spec §8).
   *
   * `tileCount` is how many places the recognition grid offers. Too few and
   * it cannot seed enough history to change the first shortlist; too many and
   * it stops being the four-second screen it is supposed to be.
   *
   * Tune against: how many tiles get tapped, and whether the first shortlist
   * has anything in Layer 3 to rank on afterwards.
   */
  coldStart: {
    tileCount: 12,
  },

  /**
   * When a favourite is allowed back into the shortlist.
   *
   * A favourite carries no information -- you already know it is there (§3).
   * Usuals live on a shelf and never auto-surface; they re-enter only once they
   * have been out of rotation long enough to be news again.
   *
   * Rurally this is the *main* source of news: after a year you have been to
   * most of twenty-five places, so news becomes the place you forgot you liked.
   * Tune against: lock-in rate on resurfaced usuals.
   */
  forgottenFavouriteDays: 90,

  /**
   * Target mix of unfamiliar to familiar places in a shortlist of ten.
   * A target, not a quota -- a rural town may not be able to supply seven.
   *
   * "Familiar" means any verdict at all, including `known`. A place tapped in
   * the recognition grid is familiar from that moment, which is what lets the
   * very first shortlist rank on something other than distance.
   *
   * Tune against: lock-in rate, reroll rate.
   */
  novelty: {
    new: 7,
    known: 3,
  },

  /**
   * The reveal draws from an already-hydrated pool, which is what makes
   * rerolls free (§7): the ten are hydrated once and the reveal picks from the
   * top of them. The cap of three rerolls is deliberately NOT a knob here --
   * the spec argues it is a commitment device rather than a budget, so tuning
   * it would be changing the design, not the settings.
   *
   * Tune against: reroll exhaustion rate.
   */
  rerollPool: {
    hydrate: 10,
    drawFromTop: 4,
  },

  /**
   * Confidence is weighted by distance: an unverified place is a fine gamble
   * at two miles and irresponsible at the top of the list at twenty-two.
   * Tune against: correction-report rate.
   */
  confidenceByDistance: {
    /** No unverified place may hold one of the first N positions... */
    protectedTopN: 3,
    /** ...once it is further away than this. */
    beyondMiles: 10,
  },

  /**
   * `New around here` -- the "genuinely new to the catalog" tick.
   *
   * Deliberately unset. It needs two Overture releases to diff and only one
   * currently has data: 2026-07-22.0's prefix still exists in S3 but its data
   * is gone, so the release the catalog was built from is the only diffable
   * one. The threshold stays null until the September release lands and the
   * appeared/disappeared counts are known (§12).
   *
   * The frontier card ships without it. `null` here means "do not show this
   * tick", not "use a default" -- there is no honest default.
   */
  newAroundHereThresholdDays: null,

  /**
   * Ranking weights (§15).
   *
   * Intentionally unspecified by the spec, and started equal on purpose: a spec
   * that invented weights would be handing over magic numbers nobody chose.
   * The scoring is a weighted sum over these four signals. Start equal, tune.
   *
   * Note what is absent: distance. Distance is a gate, not a sort key (§3).
   * Valley View's places span 0.2-0.4 miles and ten Dallas places sit at 0.0 --
   * it decides eligibility and then contributes nothing to order. Adding a
   * distance weight here would quietly undo that.
   */
  rankingWeights: {
    tagAffinity: 1,
    friendVerdicts: 1,
    confidence: 1,
    novelty: 1,
  },
} as const;

export type Tuning = typeof tuning;
