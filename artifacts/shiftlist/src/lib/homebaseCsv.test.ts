import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHomebaseCsv, matchShiftType, describeRuleProblems, describeRuleWindow } from "./homebaseCsv.js";

test("parses a straightforward export", () => {
  const csv = [
    "Employee,Date,Start,End",
    "Jane Doe,2026-08-10,9:00 AM,5:00 PM",
    "John Smith,08/10/2026,4:00 PM,11:00 PM",
  ].join("\n");

  const { rows, skipped } = parseHomebaseCsv(csv);

  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    employeeName: "Jane Doe",
    date: "2026-08-10",
    startTime: "09:00",
    endTime: "17:00",
    raw: { Employee: "Jane Doe", Date: "2026-08-10", Start: "9:00 AM", End: "5:00 PM" },
  });
  assert.equal(rows[1].date, "2026-08-10");
  assert.equal(rows[1].startTime, "16:00");
  assert.equal(rows[1].endTime, "23:00");
});

test("recognizes tolerant Homebase header variants", () => {
  const csv = [
    "Team Member,Shift Date,Clock In,Clock Out",
    "Ari Lee,2026-08-11,09:00,17:00",
  ].join("\n");

  const { rows, skipped } = parseHomebaseCsv(csv);
  assert.equal(skipped.length, 0);
  assert.equal(rows[0].employeeName, "Ari Lee");
});

test("handles quoted fields with embedded commas", () => {
  const csv = [
    "Employee,Date,Start,End,Notes",
    '"Doe, Jane",2026-08-10,9:00 AM,5:00 PM,"Covering, closing"',
  ].join("\n");

  const { rows } = parseHomebaseCsv(csv);
  assert.equal(rows[0].employeeName, "Doe, Jane");
  assert.equal(rows[0].raw.Notes, "Covering, closing");
});

test("handles \\r\\n line endings", () => {
  const csv = "Employee,Date,Start\r\nJane,2026-08-10,9:00 AM\r\n";
  const { rows } = parseHomebaseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeName, "Jane");
});

test("24-hour times parse without a meridiem", () => {
  const csv = "Employee,Date,Start,End\nJane,2026-08-10,21:00,23:30";
  const { rows } = parseHomebaseCsv(csv);
  assert.equal(rows[0].startTime, "21:00");
  assert.equal(rows[0].endTime, "23:30");
});

test("noon and midnight edge cases", () => {
  const csv = [
    "Employee,Date,Start",
    "A,2026-08-10,12:00 AM",
    "B,2026-08-10,12:00 PM",
  ].join("\n");
  const { rows } = parseHomebaseCsv(csv);
  assert.equal(rows[0].startTime, "00:00");
  assert.equal(rows[1].startTime, "12:00");
});

test("missing end time is left null, not skipped", () => {
  const csv = "Employee,Date,Start,End\nJane,2026-08-10,9:00 AM,";
  const { rows, skipped } = parseHomebaseCsv(csv);
  assert.equal(skipped.length, 0);
  assert.equal(rows[0].endTime, null);
});

test("junk rows are skipped with a reason, not silently dropped", () => {
  const csv = [
    "Employee,Date,Start",
    "Jane,not-a-date,9:00 AM",
    "John,2026-08-10,not-a-time",
    ",2026-08-10,9:00 AM",
  ].join("\n");

  const { rows, skipped } = parseHomebaseCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 3);
  assert.match(skipped[0].reason, /date/i);
  assert.match(skipped[1].reason, /time/i);
  assert.match(skipped[2].reason, /name/i);
  assert.equal(skipped[0].rowNumber, 1);
});

test("blank rows inside the file are ignored, not reported as skipped", () => {
  const csv = "Employee,Date,Start\nJane,2026-08-10,9:00 AM\n,,\nJohn,2026-08-11,10:00 AM";
  const { rows, skipped } = parseHomebaseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(skipped.length, 0);
});

test("missing header columns entirely are reported per-row, not thrown", () => {
  const csv = "Foo,Bar\nx,y";
  const { rows, skipped } = parseHomebaseCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /employee|name/i);
});

test("empty file returns empty result, not an error", () => {
  const { rows, skipped, headers } = parseHomebaseCsv("");
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped, []);
  assert.deepEqual(headers, []);
});

test("matchShiftType finds the covering rule", () => {
  const rules = [
    { shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "11:00" },
    { shiftId: 2, shiftName: "Mid", startFrom: "11:00", startUntil: "16:00" },
    { shiftId: 3, shiftName: "Close", startFrom: "16:00", startUntil: "23:59" },
  ];
  assert.equal(matchShiftType("09:00", rules)?.shiftName, "Open");
  assert.equal(matchShiftType("11:00", rules)?.shiftName, "Mid");
  assert.equal(matchShiftType("15:59", rules)?.shiftName, "Mid");
  assert.equal(matchShiftType("16:00", rules)?.shiftName, "Close");
  assert.equal(matchShiftType("23:59", rules), null); // startUntil is exclusive
});

test("matchShiftType handles a rule that wraps past midnight", () => {
  const rules = [{ shiftId: 1, shiftName: "Overnight", startFrom: "22:00", startUntil: "02:00" }];
  assert.equal(matchShiftType("23:00", rules)?.shiftName, "Overnight");
  assert.equal(matchShiftType("01:00", rules)?.shiftName, "Overnight");
  assert.equal(matchShiftType("12:00", rules), null);
});

test("matchShiftType returns null when nothing covers the time", () => {
  const rules = [{ shiftId: 1, shiftName: "Mid", startFrom: "11:00", startUntil: "16:00" }];
  assert.equal(matchShiftType("09:00", rules), null);
});

// ─── The store's real windows, against its real start times ────────────────
// Regression guard for a live import that filed every 12:00 start under Open
// and every 17:00 start under Mid.

const DEFAULT_WINDOWS = [
  { shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "11:00" },
  { shiftId: 2, shiftName: "Mid", startFrom: "11:00", startUntil: "16:00" },
  { shiftId: 3, shiftName: "Close", startFrom: "16:00", startUntil: "23:59" },
];

test("the recommended windows sort this store's real start times", () => {
  assert.equal(matchShiftType("09:30", DEFAULT_WINDOWS)?.shiftName, "Open");
  assert.equal(matchShiftType("12:00", DEFAULT_WINDOWS)?.shiftName, "Mid");
  assert.equal(matchShiftType("17:00", DEFAULT_WINDOWS)?.shiftName, "Close");
});

test("a shift with no window never takes an imported row", () => {
  // "Staff Meeting" is picked by hand; it has no rule, so it can't appear
  // in the rule list at all and nothing can be sorted into it.
  const names = ["09:30", "12:00", "17:00"].map((t) => matchShiftType(t, DEFAULT_WINDOWS)?.shiftName);
  assert.deepEqual(names, ["Open", "Mid", "Close"]);
  assert.ok(!names.includes("Staff Meeting"));
});

test("overlapping windows resolve to the earlier one, deterministically", () => {
  // The route sorts rules by start_from before calling this, so the caller
  // sees the same answer on every request rather than row order roulette.
  const overlapping = [
    { shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "16:00" },
    { shiftId: 2, shiftName: "Mid", startFrom: "11:00", startUntil: "20:00" },
  ];
  assert.equal(matchShiftType("12:00", overlapping)?.shiftName, "Open");
});

test("describeRuleProblems stays quiet on a sane configuration", () => {
  assert.deepEqual(describeRuleProblems(DEFAULT_WINDOWS), []);
});

test("describeRuleProblems names the overlap that would misfile a shift", () => {
  const overlapping = [
    { shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "16:00" },
    { shiftId: 2, shiftName: "Mid", startFrom: "11:00", startUntil: "20:00" },
  ];
  const problems = describeRuleProblems(overlapping);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Open.*Mid.*overlap/);
});

test("describeRuleProblems reports an uncovered stretch between shifts", () => {
  const gapped = [
    { shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "11:00" },
    { shiftId: 2, shiftName: "Close", startFrom: "16:00", startUntil: "23:59" },
  ];
  const problems = describeRuleProblems(gapped);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /11:00–16:00/);
});

test("a window wrapping past midnight isn't reported as a problem", () => {
  const wrapping = [
    { shiftId: 1, shiftName: "Open", startFrom: "06:00", startUntil: "14:00" },
    { shiftId: 2, shiftName: "Close", startFrom: "14:00", startUntil: "02:00" },
  ];
  assert.deepEqual(describeRuleProblems(wrapping), []);
});

test("describeRuleWindow reads as a boundary, not as working hours", () => {
  assert.equal(
    describeRuleWindow({ shiftId: 1, shiftName: "Open", startFrom: "00:00", startUntil: "11:00" }),
    "catches starts before 11:00"
  );
  assert.equal(
    describeRuleWindow({ shiftId: 2, shiftName: "Mid", startFrom: "11:00", startUntil: "16:00" }),
    "catches starts 11:00 – 16:00"
  );
  assert.equal(
    describeRuleWindow({ shiftId: 3, shiftName: "Close", startFrom: "16:00", startUntil: "23:59" }),
    "catches starts 16:00 or later"
  );
});

test("describeRuleWindow says so when a shift is never imported", () => {
  assert.equal(describeRuleWindow(undefined), "not imported");
});

test("describeRuleWindow handles a window running past midnight", () => {
  assert.equal(
    describeRuleWindow({ shiftId: 3, shiftName: "Close", startFrom: "16:00", startUntil: "02:00" }),
    "catches starts 16:00 or later, through 02:00"
  );
});
