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
 * True when `abbrev` is the "First L." form of `full` — same first name, and
 * the abbreviation's single letter is the initial of the full surname. A
 * staff entry with no surname at all ("Anthony") also matches, so a
 * first-name-only staff list still imports.
 *
 * Both the token right after the first name and the final token count as the
 * surname's start: "Mari Van Dyke" abbreviates to "Mari V." (compound
 * surname) while "Anthony James Smith" abbreviates to "Anthony S." (middle
 * name). Interior tokens are deliberately not considered — that would match
 * on a middle initial and risk pairing the wrong person.
 */
function abbreviationMatches(abbrev: string[], full: string[]): boolean {
  if (abbrev.length !== 2 || abbrev[1].length !== 1) return false;
  if (full[0] !== abbrev[0]) return false;
  if (full.length === 1) return true;
  const initial = abbrev[1];
  return full[1].startsWith(initial) || full[full.length - 1].startsWith(initial);
}

/**
 * Resolves `importedName` against `employees`.
 *
 * Tried in order — exact, then "First L." in either direction — so a staff
 * list that already matches exactly behaves exactly as it did before.
 */
export function matchEmployeeName<E extends MatchableEmployee>(
  importedName: string,
  employees: E[]
): EmployeeMatch<E> {
  const target = normalizeExact(importedName);
  if (!target) return { kind: "none" };

  const exact = employees.filter((e) => normalizeExact(e.name) === target);
  if (exact.length === 1) return { kind: "matched", employee: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const importedTokens = tokenize(importedName);
  if (importedTokens.length === 0) return { kind: "none" };

  const fuzzy = employees.filter((e) => {
    const empTokens = tokenize(e.name);
    if (empTokens.length === 0) return false;
    // Either side may be the abbreviated one: the import is abbreviated in
    // practice, but a staff list stored as "Anthony P." should not be a
    // surprising dead end.
    return (
      abbreviationMatches(importedTokens, empTokens) ||
      abbreviationMatches(empTokens, importedTokens)
    );
  });

  if (fuzzy.length === 1) return { kind: "matched", employee: fuzzy[0] };
  if (fuzzy.length > 1) return { kind: "ambiguous", candidates: fuzzy };
  return { kind: "none" };
}
