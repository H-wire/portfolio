import {
  computeRoic,
  computeRelativeStrength,
  computeTrendRaw,
  computeTimingScore,
  percentileRank,
  weightsForRiskLevel,
} from "../src/domain/factors";

describe("factors", () => {
  it("computes percentile rank with ties", () => {
    const ranks = percentileRank([1, 2, 2, 4, null]);
    expect(ranks[0]).toBeCloseTo(0);
    expect(ranks[1]).toBeCloseTo(50);
    expect(ranks[2]).toBeCloseTo(50);
    expect(ranks[3]).toBeCloseTo(100);
    expect(ranks[4]).toBeNull();
  });

  it("computes ROIC from fundamentals", () => {
    const roic = computeRoic({
      ebitTtm: 120,
      taxRate: 0.25,
      totalDebt: 100,
      totalEquity: 300,
      cashAndEquivalents: 50,
      epsTtm: 1,
      operatingCashflowTtm: 200,
    });
    expect(roic).toBeCloseTo((120 * 0.75) / 350);
  });

  it("computes Trend raw score", () => {
    const raw = computeTrendRaw(110, 105, 100);
    expect(raw).toBeCloseTo(0.5 * (110 / 100 - 1) + 0.3 * (105 / 100 - 1) + 0.2 * (110 / 105 - 1));
  });

  it("computes relative strength (6m/12m)", () => {
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-07-01", close: 120 },
      { date: "2026-01-01", close: 150 },
    ];
    const rs = computeRelativeStrength(prices as any, "2026-01-01");
    expect(rs.rs6m).toBeCloseTo(150 / 120 - 1);
    expect(rs.rs12m).toBeCloseTo(150 / 100 - 1);
  });

  it("computes timing score based on risk level", () => {
    const score = computeTimingScore(50, 5);
    expect(score).toBeCloseTo(100);
    const scoreLow = computeTimingScore(40, 1);
    expect(scoreLow).toBeLessThan(100);
    const scoreRisk1 = computeTimingScore(58, 1);
    expect(scoreRisk1).toBeCloseTo(100);
  });

  it("interpolates weights by risk level", () => {
    const weights = weightsForRiskLevel(5);
    expect(weights.w_quality).toBeCloseTo(0.25);
    const weightsHigh = weightsForRiskLevel(10);
    expect(weightsHigh.w_momentum).toBeCloseTo(0.55);
  });

  it("derives volatility score from ATR/Price percentile", () => {
    const vols = [0.1, 0.2];
    const ranks = percentileRank(vols);
    const scores = ranks.map((rank) => (rank === null ? null : 100 - rank));
    expect(scores[0]).toBeCloseTo(100);
    expect(scores[1]).toBeCloseTo(0);
  });
});
