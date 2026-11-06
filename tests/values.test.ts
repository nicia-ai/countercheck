import { describe, expect, it } from "vitest";
import {
  compareValueCandidates,
  extractValueCandidates,
  type ValueCandidate,
} from "../src/kernel/values.js";

function candidates(text: string): readonly ValueCandidate[] {
  return extractValueCandidates(text).candidates;
}

describe("structured value candidates", () => {
  it("keeps exact spans and converts supported units with decimal arithmetic", () => {
    const extracted = extractValueCandidates("Mass is 3 kg.");
    expect(extracted.coverage).toEqual({
      recognizedSpans: 1,
      unsupportedSpans: 0,
      overflow: false,
    });
    expect(extracted.candidates[0]).toMatchObject({
      id: "v_00",
      kind: "quantity",
      span: { start: 8, end: 12, text: "3 kg" },
      operator: "eq",
      lower: "3000/1",
      upper: "3000/1",
      unit: "g",
      dimension: "mass",
    });
    const converted = candidates("3 kg and 3000 g");
    expect(compareValueCandidates(converted[0]!, converted[1]!)).toEqual({
      relation: "compatible",
      reason: "overlapping_value_ranges",
    });
  });

  it("parses explicit intervals and comparator bounds", () => {
    const interval = candidates("between 2.5 and 4 km")[0]!;
    expect(interval).toMatchObject({
      operator: "interval",
      lower: "2500/1",
      upper: "4000/1",
      unit: "m",
      span: { text: "between 2.5 and 4 km" },
    });
    const lowerBound = candidates("at least 2.5 km")[0]!;
    expect(lowerBound).toMatchObject({
      operator: "gte",
      lower: "2500/1",
      upper: null,
      unit: "m",
    });
  });

  it("distinguishes overlapping and disjoint intervals including open endpoints", () => {
    const values = candidates("3–5 kg; 5–8 kg; more than 5 kg; at most 5 kg");
    expect(values).toHaveLength(4);
    expect(compareValueCandidates(values[0]!, values[1]!).relation).toBe("compatible");
    expect(compareValueCandidates(values[0]!, values[2]!)).toMatchObject({
      relation: "incompatible",
      reason: "disjoint_value_ranges",
    });
    expect(compareValueCandidates(values[0]!, values[3]!).relation).toBe("compatible");
  });

  it("accepts valid ISO dates and marks invalid or ambiguous dates unsupported", () => {
    const valid = extractValueCandidates("Effective 2024-02-29");
    expect(valid.candidates[0]).toMatchObject({
      kind: "date",
      span: { text: "2024-02-29" },
      lower: "19782",
      upper: "19782",
    });
    for (const text of ["2023-02-29", "03/04/2025", "March 4, 2025"]) {
      const parsed = extractValueCandidates(text);
      expect(parsed.candidates).toEqual([]);
      expect(parsed.coverage.unsupportedSpans).toBeGreaterThan(0);
    }
  });

  it("keeps date comparators as bounds instead of exact-date points", () => {
    const values = candidates("Deadline is before 2026-12-01; deadline is before 2026-11-01");
    expect(values).toHaveLength(2);
    expect(values.map((candidate) => candidate.operator)).toEqual(["lt", "lt"]);
    expect(compareValueCandidates(values[0]!, values[1]!).relation).toBe("compatible");
    expect(extractValueCandidates("Deadline is until 2026-12-01").coverage.unsupportedSpans).toBe(
      1,
    );
  });

  it("preserves prefix currency through comparators and keeps currency systems distinct", () => {
    const values = candidates("Price is at least $10; price is exactly $20");
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({
      operator: "gte",
      lower: "10/1",
      unit: "$",
      dimension: "currency:$",
    });
    expect(values[1]).toMatchObject({ operator: "eq", lower: "20/1", unit: "$" });
    expect(compareValueCandidates(values[0]!, values[1]!).relation).toBe("compatible");

    const currencies = candidates("USD 10 and EUR 20 and $30");
    expect(currencies.map((candidate) => candidate.dimension)).toEqual([
      "currency:USD",
      "currency:EUR",
      "currency:$",
    ]);
    expect(compareValueCandidates(currencies[0]!, currencies[1]!).relation).toBe("unknown");
    expect(compareValueCandidates(currencies[0]!, currencies[2]!).relation).toBe("unknown");
  });

  it("keeps unknown units, incomplete intervals, and approximate or spelled quantities unknown", () => {
    for (const text of [
      "5 widgets",
      "between 3 and",
      "about10kg",
      "roughly 5–7 cm",
      "ten kg",
      "five percent",
      "1e6",
      "10m users",
      "3/4kg",
      "not5kg",
      "not 5 kg",
      "not more than 5 kg",
      "Price is not $10.",
      "Price is not USD 10.",
      "€10 USD",
      "at least €10 USD",
      "$10 euros",
      "greater than 10 Fahrenheit",
      "less than 0 Celsius",
      "10–20 Fahrenheit",
      "10–20 widgets",
      "roughly greater than 10 kg",
      "greater than 10 kilogramfoo",
      "10°C",
      "50°F",
      "10°/20°",
      "±5",
      "+/- 5",
      ".5 kg",
      "10 kg/day",
      "10 km/h",
    ]) {
      const parsed = extractValueCandidates(text);
      expect(parsed.candidates, text).toEqual([]);
      expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
    }
  });

  it("applies the same unit admission rules to scalars, comparators, and both interval forms", () => {
    const forms = [
      (suffix: string) => `10${suffix}`,
      (suffix: string) => `at least 10${suffix}`,
      (suffix: string) => `≥10${suffix}`,
      (suffix: string) => `between 5 and 10${suffix}`,
      (suffix: string) => `5–10${suffix}`,
    ];
    for (const form of forms) {
      for (const suffix of [
        " Fahrenheit",
        "％",
        " ％",
        "‰",
        " ‰",
        "‱",
        " ‱",
        " ℃",
        " ℉",
        " 度",
        " kg⁄day",
        " kg′",
        " Celsius",
        " widgets",
        " kilogramfoo",
        " kgextra",
        " kg/day",
        " kg / day",
        " kg per day",
        " kg²",
        " kg^2",
        " kg·m",
        " kg.m",
        " kg-hours",
      ]) {
        const text = form(suffix);
        const parsed = extractValueCandidates(text);
        expect(parsed.candidates, text).toEqual([]);
        expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
      }
      for (const suffix of [" kg", " kilograms", " counts", " count", "", "%", " USD"]) {
        const text = form(suffix);
        const parsed = extractValueCandidates(text);
        expect(parsed.candidates, text).toHaveLength(1);
        expect(parsed.coverage.unsupportedSpans, text).toBe(0);
      }
    }
  });

  it("keeps ordinary prose delimiters after admitted values", () => {
    for (const value of ["5", "5%", "at least 5 kg", "between 5 and 10 kg", "5–10 kg"]) {
      for (const delimiter of [
        ".",
        ",",
        ";",
        ":",
        "!",
        "?",
        "(",
        ")",
        "[",
        "]",
        "{",
        "}",
        " ",
        "\n",
      ]) {
        const text = `${value}${delimiter}`;
        const parsed = extractValueCandidates(text);
        expect(parsed.candidates, text).toHaveLength(1);
        expect(parsed.coverage.unsupportedSpans, text).toBe(0);
      }
    }
  });

  it("keeps unmatched quotation and unit-prime suffixes unknown", () => {
    for (const marker of ["'", '"', "“", "”", "‘", "’", "′", "″"]) {
      for (const value of ["5", "at least 5", "between 5 and 10", "5–10"]) {
        for (const separator of ["", " "]) {
          const text = `${value}${separator}${marker} long.`;
          const parsed = extractValueCandidates(text);
          expect(parsed.candidates, text).toEqual([]);
          expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
        }
      }
    }
  });

  it("rejects qualifiers before every syntax form, including symbols and currency", () => {
    for (const prefix of [
      "about",
      "around",
      "roughly",
      "approximately",
      "approx.",
      "~",
      "≈",
      "nearly",
      "not",
    ]) {
      for (const form of [
        "10 kg",
        "≥10 kg",
        "at least $10",
        "between 5 and 10 kg",
        "5–10 kg",
        "from 5 to 10 kg",
        "on 2026-11-01",
        "2026-11-01",
        "before 2026-11-01",
      ]) {
        const text = `${prefix} ${form}`;
        const parsed = extractValueCandidates(text);
        expect(parsed.candidates, text).toEqual([]);
        expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
      }
    }
  });

  it("masks unsupported ISO intervals before extracting either endpoint", () => {
    for (const text of [
      "between 2026-11-01 and 2026-12-01",
      "between2026-11-01and2026-12-01",
      "from 2026-11-01 to 2026-12-01",
      "2026-11-01 through 2026-12-01",
      "2026-11-01–2026-12-01",
      "2026-11-01 - 2026-12-01",
    ]) {
      const parsed = extractValueCandidates(text);
      expect(parsed.candidates, text).toEqual([]);
      expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
    }
    const separate = extractValueCandidates("Opened on 2026-11-01; closed on 2026-12-01.");
    expect(separate.candidates).toHaveLength(2);
    expect(separate.coverage.unsupportedSpans).toBe(0);
  });

  it("never reports complete coverage for digits that no supported parser consumed", () => {
    for (const text of ["about10kg", "roughlybetween5and10kg", "unknown10", "tenants: 10widgets"]) {
      expect(extractValueCandidates(text).coverage.unsupportedSpans, text).toBeGreaterThan(0);
    }
  });

  it("recognizes only listed count nouns with exact spans and rational bounds", () => {
    for (const noun of [
      "participants",
      "patients",
      "subjects",
      "people",
      "users",
      "boxes",
      "items",
      "seats",
      "employees",
      "votes",
      "cases",
      "copies",
    ]) {
      const parsed = extractValueCandidates(`Exactly 180 ${noun}.`);
      expect(parsed.coverage.unsupportedSpans, noun).toBe(0);
      expect(parsed.candidates, noun).toHaveLength(1);
      expect(parsed.candidates[0]).toMatchObject({
        span: { text: `180 ${noun}` },
        lower: "180/1",
        upper: "180/1",
        dimension: "dimensionless",
        unit: "",
      });
      const values = candidates(`180 ${noun}; 230 ${noun}`);
      expect(compareValueCandidates(values[0]!, values[1]!).relation).toBe("incompatible");
    }
    const bounds = candidates("at least 180 participants; at least 230 participants");
    expect(compareValueCandidates(bounds[0]!, bounds[1]!).relation).toBe("compatible");
    for (const text of ["180 widgets", "at least 180 Fahrenheit", "between 180 and 230 Celsius"]) {
      const parsed = extractValueCandidates(text);
      expect(parsed.candidates, text).toHaveLength(0);
      expect(parsed.coverage.unsupportedSpans, text).toBeGreaterThan(0);
    }
  });

  it("returns unknown for incompatible dimensions and reports candidate overflow", () => {
    const values = candidates("5 kg and 5 seconds");
    expect(compareValueCandidates(values[0]!, values[1]!).relation).toBe("unknown");
    const many = Array.from({ length: 33 }, (_, index) => String(index + 1)).join("; ");
    const overflow = extractValueCandidates(many);
    expect(overflow.candidates).toHaveLength(32);
    expect(overflow.coverage).toMatchObject({ recognizedSpans: 33, overflow: true });
  });

  it("rejects text over the scan limit without returning a partial candidate set", () => {
    const parsed = extractValueCandidates(`${"1; ".repeat(1400)}end`);
    expect(parsed.candidates).toEqual([]);
    expect(parsed.coverage).toEqual({ recognizedSpans: 0, unsupportedSpans: 1, overflow: true });
  });
});
