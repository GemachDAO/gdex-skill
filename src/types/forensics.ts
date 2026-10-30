/**
 * Types for wallet forensics — reverse-engineering skill-proven HyperLiquid
 * wallets into size-invariant, clonable patterns.
 *
 * The {@link WinnerIntel} artifact is a read-only distillation of *what
 * skill-proven wallets actually do*: per-wallet skill-vs-luck scorecards,
 * hold-time / leverage / sizing asymmetry, and prevalence-gated aggregate
 * edges. Its field names are a stable contract consumed by downstream renderers.
 */

/** Named 0..1 components that sum (weighted) into a wallet's skill score. */
export interface SkillComponents {
  /** Positive-expectancy edge shape (win_rate·payoff form). */
  edge: number;
  /** Payoff ratio normalized to [0,1] (payoff/3). */
  payoff: number;
  /** 1 − top-5 win concentration (luck penalty inverted). */
  not_luck: number;
  /** 1 − martingale excess (adds-to-losers penalty inverted). */
  not_martingale: number;
  /** Sample-size confidence (log-scaled trade count). */
  sample: number;
}

/** Per-wallet skill scorecard. */
export interface WinnerScorecard {
  /** Wallet address. */
  address: string;
  /** Number of reconstructed round-trip trades. */
  n_trades: number;
  /** Fraction of winning trades. */
  win_rate: number;
  /** Payoff ratio = mean win / |mean loss|. */
  payoff: number;
  /** Mean trade PnL. */
  expectancy: number;
  /** Kelly fraction implied by win_rate and payoff. */
  kelly_frac: number;
  /** Edge shape: TREND, MEANREV, MIXED, or UNKNOWN (truncated). */
  machine_type: 'TREND' | 'MEANREV' | 'MIXED' | 'UNKNOWN';
  /** Avg add-size while losing / while winning (>1.5 adds to losers). */
  martingale_ratio: number;
  /** Share of gross wins from the 5 largest wins. */
  top5_win_share: number;
  /** Median winning-trade hold in hours (null if unknown). */
  median_hold_win_h: number | null;
  /** Median losing-trade hold in hours (null if unknown). */
  median_hold_loss_h: number | null;
  /** Coin -> exposure weight (sums to ~1). */
  coin_weights: Record<string, number>;
  /** True when top-5 win share exceeds 0.6 (luck warning). */
  luck_flag: boolean;
  /** Span of the fill window in hours. */
  window_hours: number;
  /** Reconstruction method: flat_to_flat or mini_trade. */
  method: 'flat_to_flat' | 'mini_trade';
  /** Weighted 0-100 skill score. */
  skill_score: number;
  /** The named component breakdown of skill_score. */
  skill_components: SkillComponents;
  /** Honesty caveats (empty for clean flat->flat). */
  caveats: string[];
}

/** One prevalence-gated aggregate feature across surviving wallets. */
export interface AggregateFeature {
  /** Feature id (e.g. direction_bias, coin_concentration). */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Fraction of survivors exhibiting the pattern. */
  prevalence: number;
  /** Number of supporting wallets. */
  support_wallets: number;
  /** Feature-specific value/direction payload. */
  magnitude: Record<string, unknown>;
  /** Confidence tier: HIGH, MED, or LOW. */
  confidence: 'HIGH' | 'MED' | 'LOW';
  /** Caveat string. */
  caveats: string;
}

/** Universe/funnel counts for one forensics run. */
export interface WinnerUniverse {
  /** Size of the raw month leaderboard. */
  board_n: number;
  /** Survivors of the cheap board pre-filters. */
  cheap_survivors_n: number;
  /** Wallets actually pulled (board survivors + watchlist, capped). */
  pulled_n: number;
  /** Wallets that survived the MM/clonability filter with trades. */
  survivors_n: number;
  /** Full per-stage filter counts. */
  filtered_counts: Record<string, number>;
}

/**
 * The winner-intel artifact — reverse-engineered forensic patterns.
 *
 * Field names match the Python `winner_intel.json` contract byte-for-byte so
 * downstream consumers render it unchanged.
 */
export interface WinnerIntel {
  /** ISO 8601 UTC timestamp of generation. */
  generated_at: string;
  /** Universe/funnel counts. */
  universe: WinnerUniverse;
  /** Per-wallet scorecards, sorted by skill_score descending. */
  scorecards: WinnerScorecard[];
  /** Prevalence-gated aggregate features. */
  aggregate_features: AggregateFeature[];
  /** Pre-rendered <1500-char desk brief. */
  desk_text: string;
}

/** Optional parameters for {@link WinnerIntel} generation. */
export interface ReverseEngineerParams {
  /** Curated wallet addresses to force into the universe (bypass filters). */
  watchlist?: string[];
  /** Cap on wallets pulled (board survivors + watchlist). */
  max?: number;
}
