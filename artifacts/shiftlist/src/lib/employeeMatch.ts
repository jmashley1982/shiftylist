/**
 * Matches a name as it appears in a Homebase schedule export against the
 * ShiftList staff list.
 *
 * Homebase's schedule grid prints names abbreviated — "Anthony P." — while
 * `employees.name` holds whatever was typed on the Employees page, usually a
 * full name ("Anthony Perez") and sometimes just a first name ("Anthony").
 * An exact string comparison therefore rejects every row of a real export.
 *
 * Pure and DB-free on purpose, mirroring homebaseCsv.ts: the caller passes the
 * employee list, so this is unit-testable without a database. Mis-matching a
 * name here silently attributes one person's attendance to another, so an
 * ambiguous name is *reported*, never resolved by picking a winner.
 */

export interface MatchableEmployee {
  id: number;
  name: string;
}

export type EmployeeMatch<E extends MatchableEmployee = MatchableEmployee> =
  | { kind: "matched"; employee: E }
  | { kind: "ambiguous"; candidates: E[] }
  | { kind: "none" };

/** Lowercased, punctuation-stripped word list: "Anthony P." → ["anthony", "p"]. */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeExact(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Shortest truncated first name treated as a real prefix. Homebase clips long
 * first names to fit its column ("Mariana" → "Mari", "Sophia" → "Soph"), but
 * one or two letters is too little signal to pair someone by, even with a
 * surname initial — "Jo B." should stay unmatched rather than silently pick
 * one of Joseph/Joanna/Jordan Baker.
 */
const MIN_TRUNCATED_FIRST_NAME = 3;

/** Parses the "First L." shape; null if `tokens` isn't that shape. */
function asAbbreviation(tokens: string[]): { first: string; initial: string } | null {
  if (tokens.length !== 2 || tokens[1].length !== 1) return null;
  return { first: tokens[0], initial: tokens[1] };
}

/**
 * True when `initial` is the initial of `full`'s surname. A name with no
 * surname at all ("Anthony") matches any initial, so a first-name-only staff
 * list still imports.
 *
 * Both the token right after the first name and the final token count as the
 * surname's start: "Mari Van Dyke" abbreviates to "Mari V." (compound
 * surname) while "Anthony James Smith" abbreviates to "Anthony S." (middle
 * name). Interior tokens are deliberately not considered — that would match
 * on a middle initial and risk pairing the wrong person.
 */
function surnameInitialMatches(initial: string, full: string[]): boolean {
  if (full.length === 1) return true;
  return full[1].startsWith(initial) || full[full.length - 1].startsWith(initial);
}

/** Whole first name equal, e.g. "Anthony P." against "Anthony Pechuls". */
function abbreviationMatches(abbrev: string[], full: string[]): boolean {
  const a = asAbbreviation(abbrev);
  if (!a || full[0] !== a.first) return false;
  return surnameInitialMatches(a.initial, full);
}

/**
 * First name truncated, e.g. "Mari B." against "Mariana Balderas". Only the
 * imported side may be truncated — Homebase is what clips names, and allowing
 * it in both directions would make far more pairs look plausible.
 */
function truncatedAbbreviationMatches(abbrev: string[], full: string[]): boolean {
  const a = asAbbreviation(abbrev);
  if (!a || a.first.length < MIN_TRUNCATED_FIRST_NAME) return false;
  if (!full[0].startsWith(a.first)) return false;
  return surnameInitialMatches(a.initial, full);
}

/**
 * Resolves `importedName` against `employees`.
 *
 * Tiers are tried in descending confidence and the first one to produce any
 * candidate decides the outcome — a later, looser tier never overrides an
 * earlier one. That ordering is what keeps "Mari B." pointing at a real
 * "Mari Bell" when the staff list holds both her and "Mariana Balderas".
 */
export function matchEmployeeName<E extends MatchableEmployee>(
  importedName: string,
  employees: E[]
): EmployeeMatch<E> {
  const target = normalizeExact(importedName);
  if (!target) return { kind: "none" };

  const importedTokens = tokenize(importedName);
  if (importedTokens.length === 0) return { kind: "none" };

  const tiers: ((e: E) => boolean)[] = [
    (e) => normalizeExact(e.name) === target,
    // Either side may carry the abbreviation: the import is abbreviated in
    // practice, but a staff list stored as "Anthony P." shouldn't be a
    // surprising dead end.
    (e) =>
      abbreviationMatches(importedTokens, tokenize(e.name)) ||
      abbreviationMatches(tokenize(e.name), importedTokens),
    (e) => truncatedAbbreviationMatches(importedTokens, tokenize(e.name)),
  ];

  for (const tier of tiers) {
    const hits = employees.filter((e) => tokenize(e.name).length > 0 && tier(e));
    if (hits.length === 1) return { kind: "matched", employee: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  return { kind: "none" };
}
