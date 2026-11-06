/**
 * Deterministic, deliberately narrow value extraction for structured-value-v1.
 * This module reports literal spans and arithmetic relations only. It does not
 * decide whether two mentions describe the same fact or entity.
 */

export type ValueOperator = "eq" | "lt" | "lte" | "gt" | "gte" | "interval";
export type ValueKind = "quantity" | "date";

export interface ValueCandidate {
  id: string;
  kind: ValueKind;
  span: { start: number; end: number; text: string };
  operator: ValueOperator;
  /** Canonical exact rational (n/d) in the candidate's base unit, or ISO day ordinal. */
  lower: string | null;
  upper: string | null;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  /** Canonical unit. Null only for ISO dates. */
  unit: string | null;
  /** Canonical dimension, including `date` and `dimensionless`. */
  dimension: string;
}

export interface ValueCandidateCoverage {
  recognizedSpans: number;
  unsupportedSpans: number;
  overflow: boolean;
}

export interface ValueCandidateExtraction {
  candidates: readonly ValueCandidate[];
  coverage: ValueCandidateCoverage;
}

export type ValueRelation = "incompatible" | "compatible" | "unknown";

export interface ValueComparison {
  relation: ValueRelation;
  reason: string;
}

const MAX_CANDIDATES = 32;
const PROSE_DELIMITERS = new Set(".,;:!?()[]{}");
const MAX_TEXT_LENGTH = 4096;
const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const SIGNED_NUMBER = String.raw`[+-]?${NUMBER}`;
const ISO_DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const COUNT_UNITS = [
  "participant",
  "participants",
  "patient",
  "patients",
  "subject",
  "subjects",
  "person",
  "people",
  "user",
  "users",
  "box",
  "boxes",
  "item",
  "items",
  "seat",
  "seats",
  "employee",
  "employees",
  "vote",
  "votes",
  "case",
  "cases",
  "copy",
  "copies",
] as const;
const COUNT_UNIT_WORD = [...COUNT_UNITS].sort((a, b) => b.length - a.length).join("|");
const UNIT_WORD = String.raw`(?:${COUNT_UNIT_WORD}|counts?|%|percent(?:age)?|millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|kilometers?|kilometres?|km|inches?|feet|foot|ft|miles?|mi|milligrams?|mg|grams?|g|kilograms?|kg|pounds?|lbs?|ounces?|oz|milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|hours?|hrs?|days?|weeks?|dollars?|usd|euros?|eur|pounds? sterling|gbp|[€£$])`;
const CURRENCY_PREFIX = String.raw`(?:USD|EUR|GBP|[$€£])`;
const RANGE_SEPARATOR = String.raw`(?:to|through|[\-–—−])`;

interface Rational {
  numerator: bigint;
  denominator: bigint;
}

interface UnitInfo {
  canonical: string;
  dimension: string;
  factor: Rational;
}

interface MutableCandidate extends Omit<ValueCandidate, "id"> {
  id?: string;
}

const unitAliases = new Map<string, UnitInfo>();

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error("Invalid rational denominator.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
}

function parseDecimal(value: string): Rational {
  const compact = value.replaceAll(",", "");
  const sign = compact.startsWith("-") ? -1n : 1n;
  const unsigned = compact.replace(/^[+-]/, "");
  const [whole = "0", fractional = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(fractional.length);
  const numerator = BigInt(`${whole}${fractional}` || "0") * sign;
  return rational(numerator, denominator);
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function serialize(value: Rational): string {
  return `${value.numerator}/${value.denominator}`;
}

function compareRational(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function register(
  names: readonly string[],
  canonical: string,
  dimension: string,
  factor: string,
): void {
  const info: UnitInfo = { canonical, dimension, factor: parseDecimal(factor) };
  for (const name of names) unitAliases.set(name.toLowerCase(), info);
}

register(["", "count", "counts", ...COUNT_UNITS], "", "dimensionless", "1");
register(["%", "percent", "percentage"], "ratio", "ratio", "0.01");
register(["mm", "millimeter", "millimeters", "millimetre", "millimetres"], "m", "length", "0.001");
register(["cm", "centimeter", "centimeters", "centimetre", "centimetres"], "m", "length", "0.01");
register(["meter", "meters", "metre", "metres"], "m", "length", "1");
register(["km", "kilometer", "kilometers", "kilometre", "kilometres"], "m", "length", "1000");
register(["inch", "inches"], "m", "length", "0.0254");
register(["ft", "foot", "feet"], "m", "length", "0.3048");
register(["mi", "mile", "miles"], "m", "length", "1609.344");
register(["mg", "milligram", "milligrams"], "g", "mass", "0.001");
register(["g", "gram", "grams"], "g", "mass", "1");
register(["kg", "kilogram", "kilograms"], "g", "mass", "1000");
register(["lb", "lbs"], "g", "mass", "453.59237");
register(["oz", "ounce", "ounces"], "g", "mass", "28.349523125");
register(["ms", "millisecond", "milliseconds"], "s", "time", "0.001");
register(["s", "sec", "secs", "second", "seconds"], "s", "time", "1");
register(["min", "mins", "minute", "minutes"], "s", "time", "60");
register(["h", "hr", "hrs", "hour", "hours"], "s", "time", "3600");
register(["d", "day", "days"], "s", "time", "86400");
register(["week", "weeks"], "s", "time", "604800");
register(["$", "dollar", "dollars"], "$", "currency:$", "1");
register(["€"], "€", "currency:€", "1");
register(["£"], "£", "currency:£", "1");
register(["usd"], "USD", "currency:USD", "1");
register(["eur", "euro", "euros"], "EUR", "currency:EUR", "1");
register(["gbp", "pound sterling", "pounds sterling"], "GBP", "currency:GBP", "1");

const GRAMMATICAL_WORDS = new Set([
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "with",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "as",
  "by",
  "from",
  "then",
  "than",
  "which",
  "that",
  "who",
  "when",
  "where",
  "while",
]);

function unitInfo(raw: string): UnitInfo | null {
  return unitAliases.get(raw.trim().toLowerCase()) ?? null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validIsoDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] ?? 0);
}

function dateOrdinal(value: string): number {
  const [yearText, monthText, dayText] = value.split("-");
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  return date.getTime() / 86_400_000;
}

function spanFor(text: string, start: number, end: number): ValueCandidate["span"] {
  return { start, end, text: text.slice(start, end) };
}

function makeQuantity(
  text: string,
  start: number,
  end: number,
  operator: ValueOperator,
  lower: Rational | null,
  upper: Rational | null,
  unit: UnitInfo | null,
  lowerInclusive = true,
  upperInclusive = true,
): MutableCandidate {
  return {
    kind: "quantity",
    span: spanFor(text, start, end),
    operator,
    lower: lower ? serialize(lower) : null,
    upper: upper ? serialize(upper) : null,
    lowerInclusive,
    upperInclusive,
    unit: unit?.canonical ?? null,
    dimension: unit?.dimension ?? "dimensionless",
  };
}

function operatorFor(raw: string): { operator: ValueOperator; inclusive: boolean } | null {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (["<", "less than", "under", "below", "fewer than"].includes(normalized))
    return { operator: "lt", inclusive: false };
  if (["<=", "≤", "at most", "no more than", "up to"].includes(normalized))
    return { operator: "lte", inclusive: true };
  if ([">", "more than", "over", "greater than", "above"].includes(normalized))
    return { operator: "gt", inclusive: false };
  if ([">=", "≥", "at least", "no less than", "no fewer than"].includes(normalized))
    return { operator: "gte", inclusive: true };
  return null;
}

function expandOperator(
  operator: ValueOperator,
  value: Rational,
): [Rational | null, Rational | null, boolean, boolean] {
  switch (operator) {
    case "eq":
      return [value, value, true, true];
    case "lt":
      return [null, value, false, false];
    case "lte":
      return [null, value, false, true];
    case "gt":
      return [value, null, false, false];
    case "gte":
      return [value, null, true, false];
    case "interval":
      return [null, null, false, false];
  }
}

interface ExtractionState {
  candidates: MutableCandidate[];
  unsupportedCount: number;
  occupied: Uint8Array;
  unsupported: Uint8Array;
}

function overlaps(start: number, end: number, mask: Uint8Array): boolean {
  for (let index = start; index < end; index += 1) if (mask[index]) return true;
  return false;
}

function addUnsupported(state: ExtractionState, start: number, end: number): void {
  if (!overlaps(start, end, state.unsupported)) state.unsupportedCount += 1;
  state.occupied.fill(1, start, end);
  state.unsupported.fill(1, start, end);
}

// Every syntax branch submits its complete span here. An unconsumed qualifier or
// unit extension must never turn a partial match into an exact value.
function addCandidate(text: string, state: ExtractionState, candidate: MutableCandidate): void {
  const { start, end } = candidate.span;
  if (overlaps(start, end, state.occupied)) return;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const qualifiedPrefix =
    /(?:about|around|roughly|approximately|approx\.?|circa|nearly|almost|not|never|isn't|wasn't|[~≈])\s*(?:(?:equal to|exactly|from|on)\s*)?$/i;
  const unsupportedPrefix =
    candidate.operator === "eq" &&
    /(?:\b(?:between|from|at least|at most|no less than|no more than|no fewer than|less than|fewer than|more than|greater than|under|over|above|below|up to|not|never)|[<>≤≥]=?)\s*$/i.test(
      before,
    );
  const nextWord = after.match(/^\s+([\p{L}]+)/u)?.[1]?.toLowerCase();
  const unknownSuffix =
    candidate.kind === "quantity" && nextWord !== undefined && !GRAMMATICAL_WORDS.has(nextWord);
  const partialSuffix = /^[\p{L}]/u.test(after) || /^\s*\.(?=[\p{L}\p{N}])/u.test(after);
  const suffixToken = after.trimStart();
  const suffixBoundary = suffixToken[0];
  const unsupportedBoundary =
    suffixBoundary !== undefined &&
    !/^[\p{L}]/u.test(suffixToken) &&
    !PROSE_DELIMITERS.has(suffixBoundary);
  const partialStart = /[\p{L}\p{N}_/.^·×°²³⁻]$/u.test(before);
  const prefixCurrency = candidate.span.text.match(
    /(?:^|\s|[<>≤≥])((?:USD|EUR|GBP|[$€£]))\s*[+-]?\d/i,
  )?.[1];
  const conflictingCurrency =
    prefixCurrency !== undefined && unitInfo(prefixCurrency)?.canonical !== candidate.unit;
  const approximateSuffix = /^\s+(?:approximately|approx\.?|roughly|circa)\b/i.test(after);
  if (
    qualifiedPrefix.test(before) ||
    unsupportedPrefix ||
    unknownSuffix ||
    partialSuffix ||
    unsupportedBoundary ||
    partialStart ||
    approximateSuffix ||
    conflictingCurrency
  ) {
    addUnsupported(state, start, end);
    return;
  }
  state.occupied.fill(1, start, end);
  state.candidates.push(candidate);
}

function markUnsupportedDateRanges(text: string, state: ExtractionState): void {
  // Date intervals are outside the supported grammar. Mask the whole interval
  // before extracting dates so neither endpoint can masquerade as an exact day.
  const pattern = new RegExp(
    String.raw`\bbetween\s*${ISO_DATE}\s*and\s*${ISO_DATE}|${ISO_DATE}\s*(?:to|through|[-–—−])\s*${ISO_DATE}`,
    "gi",
  );
  for (const match of text.matchAll(pattern)) {
    addUnsupported(state, match.index!, match.index! + match[0].length);
  }
}

function extractDateCandidates(text: string, state: ExtractionState): void {
  const pattern = new RegExp(String.raw`(?<![\d/])${ISO_DATE}(?![\d/])`, "g");
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!validIsoDate(match[0])) {
      addUnsupported(state, start, end);
      continue;
    }
    const preceding = text.slice(Math.max(0, start - 24), start);
    const symbolicPrefix = preceding.match(/(?:<=|>=|<|>|≤|≥)\s*$/);
    const wordPrefix = preceding.match(/\b(on or before|on or after|before|after|until|by)\s*$/i);
    if (wordPrefix && /\b(?:not|never)\s+$/i.test(preceding.slice(0, -wordPrefix[0].length))) {
      addUnsupported(state, start - wordPrefix[0].length, end);
      continue;
    }
    if (wordPrefix && /^(until|by)$/i.test(wordPrefix[1]!)) {
      addUnsupported(state, start - wordPrefix[0].length, end);
      continue;
    }
    const operatorText = symbolicPrefix?.[0].trim();
    const operator = operatorText
      ? operatorFor(operatorText)?.operator
      : wordPrefix?.[1]?.toLowerCase() === "before"
        ? "lt"
        : wordPrefix?.[1]?.toLowerCase() === "after"
          ? "gt"
          : wordPrefix?.[1]?.toLowerCase() === "on or before"
            ? "lte"
            : wordPrefix?.[1]?.toLowerCase() === "on or after"
              ? "gte"
              : undefined;
    const prefixLength = symbolicPrefix?.[0].length ?? wordPrefix?.[0].length ?? 0;
    const spanStart = start - prefixLength;
    const ordinal = dateOrdinal(match[0]);
    const value = String(ordinal);
    let candidateOperator: ValueOperator = "eq";
    let lower: string | null = value;
    let upper: string | null = value;
    let lowerInclusive = true;
    let upperInclusive = true;
    if (operator) {
      candidateOperator = operator;
      lower = operator === "gt" || operator === "gte" ? value : null;
      upper = operator === "lt" || operator === "lte" ? value : null;
      lowerInclusive = operator === "gte";
      upperInclusive = operator === "lte";
    }
    addCandidate(text, state, {
      kind: "date",
      span: spanFor(text, spanStart, end),
      operator: candidateOperator,
      lower,
      upper,
      lowerInclusive,
      upperInclusive,
      unit: null,
      dimension: "date",
    });
  }
}

function extractNumericCandidates(text: string, state: ExtractionState): void {
  // Ambiguous calendar spellings and malformed grouping are unsupported as
  // whole spans, so their digits cannot be offered as ordinary quantities.
  const ambiguousDatePattern = /\b\d{1,4}[/.]\d{1,2}[/.]\d{1,4}\b/g;
  for (const match of text.matchAll(ambiguousDatePattern)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const nonPaddedDate = /\b\d{1,4}-\d{1,2}-\d{1,4}\b/g;
  for (const match of text.matchAll(nonPaddedDate)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(match[0])) continue;
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const malformedGrouping = /\b\d{1,3},\d{1,2}\b/g;
  for (const match of text.matchAll(malformedGrouping)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const monthNames =
    "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  const namedDate = new RegExp(
    String.raw`\b(?:${monthNames})\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:${monthNames})\.?[,]?\s+\d{4}\b`,
    "gi",
  );
  for (const match of text.matchAll(namedDate)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }

  const incompleteBetween = new RegExp(
    String.raw`\bbetween\s+${SIGNED_NUMBER}(?:\s*${UNIT_WORD})?\s+and\b(?!\s*${SIGNED_NUMBER})`,
    "gi",
  );
  for (const match of text.matchAll(incompleteBetween)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }

  const fraction = new RegExp(
    String.raw`(?<![\w/])${SIGNED_NUMBER}\s*/\s*${NUMBER}(?:\s*${UNIT_WORD})?(?![\w/])`,
    "gi",
  );
  for (const match of text.matchAll(fraction)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }

  // Scientific notation and spelled-out quantities are not converted into
  // exact candidates by this deliberately narrow parser.
  const scientific = /(?<![\w/])[+-]?\d+(?:\.\d+)?[eE][+-]?\d+(?!\w)/g;
  for (const match of text.matchAll(scientific)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const leadingDecimal = /(?<![\w.])\.\d+(?:\s*[\p{L}°]+)?/gu;
  for (const match of text.matchAll(leadingDecimal)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const uncertainSignPattern = new RegExp(
    String.raw`(?:±|\+\s*\/\s*[-−])\s*${SIGNED_NUMBER}`,
    "giu",
  );
  for (const match of text.matchAll(uncertainSignPattern)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const prefixedCurrencyRange = new RegExp(
    String.raw`(?<![\w/])${CURRENCY_PREFIX}\s*${SIGNED_NUMBER}\s*${RANGE_SEPARATOR}\s*(?:${CURRENCY_PREFIX}\s*)?${SIGNED_NUMBER}`,
    "giu",
  );
  for (const match of text.matchAll(prefixedCurrencyRange)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }
  const numberWords =
    "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";
  const spelledQuantity = new RegExp(
    String.raw`\b(?:${numberWords})(?:[- ](?:${numberWords}))*\s+(?:${UNIT_WORD})\b`,
    "gi",
  );
  for (const match of text.matchAll(spelledQuantity)) {
    const start = match.index!;
    addUnsupported(state, start, start + match[0].length);
  }

  const unit = `(?:\\s*(${UNIT_WORD}))?`;
  const between = new RegExp(
    String.raw`\bbetween\s+(${SIGNED_NUMBER})${unit}\s+and\s+(${SIGNED_NUMBER})${unit}`,
    "gi",
  );
  for (const match of text.matchAll(between)) {
    const start = match.index!;
    const end = start + match[0].length;
    const first = parseDecimal(match[1]!);
    const second = parseDecimal(match[3]!);
    const firstUnit = match[2] ? unitInfo(match[2]) : null;
    const secondUnit = match[4] ? unitInfo(match[4]) : null;
    if ((match[2] && !firstUnit) || (match[4] && !secondUnit)) {
      addUnsupported(state, start, end);
      continue;
    }
    if (firstUnit && secondUnit && firstUnit.dimension !== secondUnit.dimension) {
      addUnsupported(state, start, end);
      continue;
    }
    const common = firstUnit ?? secondUnit;
    const a = firstUnit
      ? multiply(first, firstUnit.factor)
      : common
        ? multiply(first, common.factor)
        : first;
    const b = secondUnit
      ? multiply(second, secondUnit.factor)
      : common
        ? multiply(second, common.factor)
        : second;
    const startValue = compareRational(a, b) <= 0 ? a : b;
    const endValue = compareRational(a, b) <= 0 ? b : a;
    addCandidate(
      text,
      state,
      makeQuantity(text, start, end, "interval", startValue, endValue, common),
    );
  }

  const range = new RegExp(
    String.raw`(${SIGNED_NUMBER})${unit}\s*${RANGE_SEPARATOR}\s*(${SIGNED_NUMBER})${unit}(?![\w/])`,
    "gi",
  );
  for (const match of text.matchAll(range)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, state.occupied)) continue;
    const first = parseDecimal(match[1]!);
    const second = parseDecimal(match[3]!);
    const firstUnit = match[2] ? unitInfo(match[2]) : null;
    const secondUnit = match[4] ? unitInfo(match[4]) : null;
    if ((match[2] && !firstUnit) || (match[4] && !secondUnit)) {
      addUnsupported(state, start, end);
      continue;
    }
    if (firstUnit && secondUnit && firstUnit.dimension !== secondUnit.dimension) {
      addUnsupported(state, start, end);
      continue;
    }
    const common = firstUnit ?? secondUnit;
    const a = firstUnit
      ? multiply(first, firstUnit.factor)
      : common
        ? multiply(first, common.factor)
        : first;
    const b = secondUnit
      ? multiply(second, secondUnit.factor)
      : common
        ? multiply(second, common.factor)
        : second;
    const low = compareRational(a, b) <= 0 ? a : b;
    const high = compareRational(a, b) <= 0 ? b : a;
    addCandidate(text, state, makeQuantity(text, start, end, "interval", low, high, common));
  }

  const comparatorPattern = new RegExp(
    String.raw`(?:\b(at least|no less than|no fewer than|at most|no more than|less than|fewer than|more than|greater than|under|over|above|below|up to)|([<>]=?|[≤≥]))\s*(${CURRENCY_PREFIX}\s*)?(${SIGNED_NUMBER})${unit}(?![\w/])`,
    "gi",
  );
  for (const match of text.matchAll(comparatorPattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, state.occupied)) continue;
    const rawOperator = match[1] ?? match[2] ?? "";
    const parsedOperator = operatorFor(rawOperator);
    const prefixUnit = match[3] ? unitInfo(match[3].trim()) : null;
    const suffixUnit = match[5] ? unitInfo(match[5]) : null;
    if (
      !parsedOperator ||
      (match[3] && !prefixUnit) ||
      (match[5] && !suffixUnit) ||
      (prefixUnit && suffixUnit && prefixUnit.canonical !== suffixUnit.canonical)
    ) {
      addUnsupported(state, start, end);
      continue;
    }
    const parsedUnit = prefixUnit ?? suffixUnit;
    const numeric = parseDecimal(match[4]!);
    const value = parsedUnit ? multiply(numeric, parsedUnit.factor) : numeric;
    const [lower, upper, lowerInclusive, upperInclusive] = expandOperator(
      parsedOperator.operator,
      value,
    );
    addCandidate(
      text,
      state,
      makeQuantity(
        text,
        start,
        end,
        parsedOperator.operator,
        lower,
        upper,
        parsedUnit,
        lowerInclusive,
        upperInclusive,
      ),
    );
  }

  const scalarPattern = new RegExp(
    String.raw`(?<![\w/])(${CURRENCY_PREFIX}\s*)?(${SIGNED_NUMBER})${unit}(?![\w/])`,
    "gi",
  );
  for (const match of text.matchAll(scalarPattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, state.occupied)) continue;

    const prefixCurrency = match[1]?.trim();
    const suffixUnit = match[3];
    const prefixUnit = prefixCurrency ? unitInfo(prefixCurrency) : null;
    const parsedUnit = suffixUnit ? unitInfo(suffixUnit) : prefixUnit;
    if ((suffixUnit && !unitInfo(suffixUnit)) || (prefixCurrency && !prefixUnit)) {
      addUnsupported(state, start, end);
      continue;
    }
    const numericText = match[2]!;
    const numeric = parseDecimal(numericText);
    const converted = parsedUnit ? multiply(numeric, parsedUnit.factor) : numeric;
    addCandidate(
      text,
      state,
      makeQuantity(text, start, end, "eq", converted, converted, parsedUnit),
    );
  }
}

/** Extract bounded literal candidates and expose unsupported or overflowing coverage. */
export function extractValueCandidates(text: string): ValueCandidateExtraction {
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      candidates: [],
      coverage: { recognizedSpans: 0, unsupportedSpans: 1, overflow: true },
    };
  }
  const state: ExtractionState = {
    candidates: [],
    unsupportedCount: 0,
    occupied: new Uint8Array(text.length),
    unsupported: new Uint8Array(text.length),
  };
  markUnsupportedDateRanges(text, state);
  extractDateCandidates(text, state);
  extractNumericCandidates(text, state);
  // Any digits left outside admitted or explicitly unsupported spans indicate
  // unparsed numeric syntax, including numbers attached to unknown prefixes.
  for (const match of text.matchAll(/\d+/g)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!overlaps(start, end, state.occupied)) addUnsupported(state, start, end);
  }

  const sorted = state.candidates.sort(
    (left, right) => left.span.start - right.span.start || left.span.end - right.span.end,
  );
  const overflow = sorted.length > MAX_CANDIDATES;
  const candidates = sorted.slice(0, MAX_CANDIDATES).map((candidate, index) => ({
    ...candidate,
    id: `v_${String(index).padStart(2, "0")}`,
  }));
  return {
    candidates,
    coverage: {
      recognizedSpans: sorted.length,
      unsupportedSpans: state.unsupportedCount,
      overflow,
    },
  };
}

function parseCanonicalRational(value: string): Rational | null {
  const match = value.match(/^(-?\d+)\/(\d+)$/);
  if (!match || BigInt(match[2]!) === 0n) return null;
  return rational(BigInt(match[1]!), BigInt(match[2]!));
}

function quantityBounds(candidate: ValueCandidate): [Rational | null, Rational | null] | null {
  if (candidate.kind !== "quantity") return null;
  const lower = candidate.lower === null ? null : parseCanonicalRational(candidate.lower);
  const upper = candidate.upper === null ? null : parseCanonicalRational(candidate.upper);
  if ((candidate.lower !== null && !lower) || (candidate.upper !== null && !upper)) return null;
  return [lower, upper];
}

function intervalIsDisjoint(left: ValueCandidate, right: ValueCandidate): boolean | null {
  if (left.dimension !== right.dimension || left.kind !== right.kind) return null;
  if (left.kind === "date") {
    if (left.lower !== null && right.upper !== null) {
      const difference = Number(left.lower) - Number(right.upper);
      if (difference > 0 || (difference === 0 && !(left.lowerInclusive && right.upperInclusive)))
        return true;
    }
    if (right.lower !== null && left.upper !== null) {
      const difference = Number(right.lower) - Number(left.upper);
      if (difference > 0 || (difference === 0 && !(right.lowerInclusive && left.upperInclusive)))
        return true;
    }
    return false;
  }
  const leftBounds = quantityBounds(left);
  const rightBounds = quantityBounds(right);
  if (!leftBounds || !rightBounds) return null;
  const [leftLower, leftUpper] = leftBounds;
  const [rightLower, rightUpper] = rightBounds;
  if (leftLower && rightUpper) {
    const compared = compareRational(leftLower, rightUpper);
    if (compared > 0 || (compared === 0 && !(left.lowerInclusive && right.upperInclusive)))
      return true;
  }
  if (rightLower && leftUpper) {
    const compared = compareRational(rightLower, leftUpper);
    if (compared > 0 || (compared === 0 && !(right.lowerInclusive && left.upperInclusive)))
      return true;
  }
  return false;
}

/** Compare selected literal value candidates without resolving their semantics. */
export function compareValueCandidates(
  left: ValueCandidate,
  right: ValueCandidate,
): ValueComparison {
  if (left.kind !== right.kind) return { relation: "unknown", reason: "different_value_kinds" };
  if (left.dimension !== right.dimension)
    return { relation: "unknown", reason: "incompatible_units" };
  const disjoint = intervalIsDisjoint(left, right);
  if (disjoint === null) return { relation: "unknown", reason: "invalid_candidate" };
  return disjoint
    ? { relation: "incompatible", reason: "disjoint_value_ranges" }
    : { relation: "compatible", reason: "overlapping_value_ranges" };
}
