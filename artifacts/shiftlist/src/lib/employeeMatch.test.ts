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
