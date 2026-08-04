import { test } from "node:test";
import assert from "node:assert/strict";
import { matchEmployeeName } from "./employeeMatch.js";

const STAFF = [
  { id: 1, name: "Anthony Perez" },
  { id: 2, name: "Mari Bell" },
  { id: 3, name: "Rachel Ruiz" },
  { id: 4, name: "Walter Cruz" },
];

function matchedName(imported: string, staff = STAFF): string | null {
  const result = matchEmployeeName(imported, staff);
  return result.kind === "matched" ? result.employee.name : null;
}

test("exact match still wins (existing staff lists are unaffected)", () => {
  assert.equal(matchedName("Anthony Perez"), "Anthony Perez");
  assert.equal(matchedName("  anthony   perez  "), "Anthony Perez");
});

test("Homebase's abbreviated form matches a full name", () => {
  assert.equal(matchedName("Anthony P."), "Anthony Perez");
  assert.equal(matchedName("Mari B."), "Mari Bell");
  assert.equal(matchedName("Walter C."), "Walter Cruz");
});

test("abbreviation matching is case- and punctuation-insensitive", () => {
  assert.equal(matchedName("anthony p"), "Anthony Perez");
  assert.equal(matchedName("ANTHONY P."), "Anthony Perez");
  assert.equal(matchedName("Anthony  P ."), "Anthony Perez");
});

test("a first-name-only staff list still imports", () => {
  const staff = [{ id: 9, name: "Anthony" }];
  assert.equal(matchedName("Anthony P.", staff), "Anthony");
});

test("a wrong surname initial does NOT match", () => {
  // The whole point of the feature is attributing attendance to the right
  // person — a near-miss must fail loudly rather than pick someone.
  assert.equal(matchEmployeeName("Anthony S.", STAFF).kind, "none");
});

test("a different first name does NOT match", () => {
  assert.equal(matchEmployeeName("Antonio P.", STAFF).kind, "none");
});

test("two staff sharing first name + initial is ambiguous, not a guess", () => {
  const staff = [
    { id: 1, name: "Anthony Perez" },
    { id: 2, name: "Anthony Pike" },
  ];
  const result = matchEmployeeName("Anthony P.", staff);
  assert.equal(result.kind, "ambiguous");
  if (result.kind !== "ambiguous") throw new Error("unreachable");
  assert.deepEqual(
    result.candidates.map((c) => c.name).sort(),
    ["Anthony Perez", "Anthony Pike"]
  );
});

test("an exact match beats an otherwise-ambiguous abbreviation", () => {
  const staff = [
    { id: 1, name: "Anthony P." },
    { id: 2, name: "Anthony Perez" },
  ];
  assert.equal(matchedName("Anthony P.", staff), "Anthony P.");
});

test("a staff list stored abbreviated matches a full imported name", () => {
  const staff = [{ id: 1, name: "Anthony P." }];
  assert.equal(matchedName("Anthony Perez", staff), "Anthony P.");
});

test("unmatched and empty inputs report none rather than throwing", () => {
  assert.equal(matchEmployeeName("Nobody Here", STAFF).kind, "none");
  assert.equal(matchEmployeeName("", STAFF).kind, "none");
  assert.equal(matchEmployeeName("   ", STAFF).kind, "none");
  assert.equal(matchEmployeeName("Anthony P.", []).kind, "none");
});

test("multi-word surnames match on the last token's initial", () => {
  const staff = [{ id: 1, name: "Mari Van Dyke" }];
  assert.equal(matchedName("Mari V.", staff), "Mari Van Dyke");
});

// ─── Homebase also truncates long first names to fit its column ────────────
// Taken from a real export against the real staff list: "Mariana Balderas"
// prints as "Mari B." and "Sophia Valadez" as "Soph V.".

const REAL_STAFF = [
  { id: 1, name: "Jason Ashley" },
  { id: 2, name: "Trevor Keenan" },
  { id: 3, name: "Rachel Ramirez" },
  { id: 4, name: "Summer Kutscher" },
  { id: 5, name: "Sophia Valadez" },
  { id: 6, name: "Mariana Balderas" },
  { id: 7, name: "Anthony Pechuls" },
  { id: 8, name: "Walter Chatelain" },
];

test("a truncated first name matches the full staff name", () => {
  assert.equal(matchedName("Mari B.", REAL_STAFF), "Mariana Balderas");
  assert.equal(matchedName("Soph V.", REAL_STAFF), "Sophia Valadez");
});

test("every name in the real export resolves", () => {
  const fromExport = [
    ["Jason A.", "Jason Ashley"],
    ["Trevor K.", "Trevor Keenan"],
    ["Rachel R.", "Rachel Ramirez"],
    ["Summer K.", "Summer Kutscher"],
    ["Soph V.", "Sophia Valadez"],
    ["Mari B.", "Mariana Balderas"],
    ["Anthony P.", "Anthony Pechuls"],
    ["Walter C.", "Walter Chatelain"],
  ];
  for (const [imported, expected] of fromExport) {
    assert.equal(matchedName(imported, REAL_STAFF), expected, imported);
  }
});

test("an exact first name beats a truncated one", () => {
  // Both are plausible readings of "Mari B."; the one that needs no
  // truncation is the confident answer and must win outright.
  const staff = [
    { id: 1, name: "Mari Bell" },
    { id: 2, name: "Mariana Balderas" },
  ];
  assert.equal(matchedName("Mari B.", staff), "Mari Bell");
});

test("two truncation candidates are ambiguous, not a coin flip", () => {
  const staff = [
    { id: 1, name: "Mariana Balderas" },
    { id: 2, name: "Marisol Beltran" },
  ];
  assert.equal(matchEmployeeName("Mari B.", staff).kind, "ambiguous");
});

test("a truncated first name still needs the right surname initial", () => {
  assert.equal(matchEmployeeName("Mari K.", REAL_STAFF).kind, "none");
});

test("one or two letters is too little to match on", () => {
  // "Jo B." could be any of these; guessing would pin a shift on the wrong
  // person, so it stays unmatched and gets reported.
  const staff = [{ id: 1, name: "Joseph Baker" }];
  assert.equal(matchEmployeeName("Jo B.", staff).kind, "none");
  assert.equal(matchEmployeeName("J B.", staff).kind, "none");
});
