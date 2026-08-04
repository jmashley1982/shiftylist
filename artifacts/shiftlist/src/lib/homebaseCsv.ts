/**
 * Parses a Homebase schedule export (CSV) into normalized rows.
 *
 * Pure and DB-free on purpose: Homebase's own export columns/casing shift
 * between their "Schedule" and "Team" export screens, and we don't want a
 * format surprise to be a silent no-op. Every input row either becomes a
 * ParsedScheduleRow or a SkippedRow with a human reason — nothing is dropped
 * quietly. The caller (the /schedule/preview route) is responsible for
 * matching employeeName against the employees table and startTime against
 * shift_time_rules; this module knows nothing about the database.
 */

export interface ParsedScheduleRow {
  employeeName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, 24h, wall-clock (no timezone math)
  endTime: string | null; // HH:MM, 24h, or null if not present/parseable
  raw: Record<string, string>;
}

export interface SkippedRow {
  rowNumber: number; // 1-based, counting only data rows (header excluded)
  reason: string;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedScheduleRow[];
  skipped: SkippedRow[];
  headers: string[];
}

// ════════════════════════════════════ CSV line splitting ════════════════════

/**
 * Splits CSV text into rows of fields, honoring double-quoted fields with
 * embedded commas, newlines, and "" as an escaped quote. Handles both \n and
 * \r\n line endings.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }

  // Trailing field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  // Drop fully-empty trailing rows produced by a trailing blank line
  while (rows.length > 0 && rows[rows.length - 1].every((f) => f.trim() === "")) {
    rows.pop();
  }

  return rows;
}

// ════════════════════════════════════ Header detection ══════════════════════

type ColumnKey = "employee" | "date" | "start" | "end";

const HEADER_PATTERNS: Record<ColumnKey, RegExp[]> = {
  employee: [/^name$/, /employee/, /team\s*member/, /^staff$/, /worker/],
  date: [/^date$/, /^day$/, /shift\s*date/],
  start: [/^start$/, /start\s*time/, /clock\s*in/, /shift\s*start/],
  end: [/^end$/, /end\s*time/, /clock\s*out/, /finish/, /shift\s*end/],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

/** Maps each ColumnKey to a header index, first unclaimed match wins. */
function detectColumns(headers: string[]): Partial<Record<ColumnKey, number>> {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set<number>();
  const result: Partial<Record<ColumnKey, number>> = {};

  for (const key of Object.keys(HEADER_PATTERNS) as ColumnKey[]) {
    for (const pattern of HEADER_PATTERNS[key]) {
      const idx = normalized.findIndex((h, i) => !claimed.has(i) && pattern.test(h));
      if (idx !== -1) {
        result[key] = idx;
        claimed.add(idx);
        break;
      }
    }
  }

  return result;
}

// ════════════════════════════════════ Date parsing ═══════════════════════════

/** "YYYY-MM-DD" | "MM/DD/YYYY" | "M/D/YYYY" | "MM/DD/YY" -> "YYYY-MM-DD", or null. */
function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return toIsoDate(Number(y), Number(m), Number(d));
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, m, d, yRaw] = slash;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return toIsoDate(y, Number(m), Number(d));
  }

  return null;
}

function toIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ════════════════════════════════════ Time parsing ═══════════════════════════

/** "9:00 AM" | "9am" | "09:00" | "21:00" | "9:00pm" -> "HH:MM" (24h), or null. */
function parseTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const withMeridiem = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (withMeridiem) {
    let [, hRaw, mRaw, mer] = withMeridiem;
    let h = Number(hRaw);
    const min = mRaw ? Number(mRaw) : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    const isPm = mer.toLowerCase() === "p";
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const bare24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (bare24) {
    const h = Number(bare24[1]);
    const min = Number(bare24[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  return null;
}

// ════════════════════════════════════ Main entry point ══════════════════════

export function parseHomebaseCsv(csvText: string): ParseResult {
  const rawRows = parseCsvRows(csvText);
  if (rawRows.length === 0) {
    return { rows: [], skipped: [], headers: [] };
  }

  const headers = rawRows[0].map((h) => h.trim());
  const columns = detectColumns(headers);
  const dataRows = rawRows.slice(1);

  const rows: ParsedScheduleRow[] = [];
  const skipped: SkippedRow[] = [];

  const toRawRecord = (fields: string[]): Record<string, string> => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h || `column_${i + 1}`] = fields[i] ?? "";
    });
    return rec;
  };

  dataRows.forEach((fields, i) => {
    const rowNumber = i + 1;
    const raw = toRawRecord(fields);

    if (fields.every((f) => f.trim() === "")) {
      // Blank row inside the file — not an error, just nothing to report.
      return;
    }

    if (columns.employee === undefined) {
      skipped.push({ rowNumber, raw, reason: "No employee/name column found in header" });
      return;
    }
    if (columns.date === undefined) {
      skipped.push({ rowNumber, raw, reason: "No date column found in header" });
      return;
    }
    if (columns.start === undefined) {
      skipped.push({ rowNumber, raw, reason: "No start time column found in header" });
      return;
    }

    const employeeName = (fields[columns.employee] ?? "").trim();
    if (!employeeName) {
      skipped.push({ rowNumber, raw, reason: "Missing employee name" });
      return;
    }

    const dateRaw = fields[columns.date] ?? "";
    const date = parseDate(dateRaw);
    if (!date) {
      skipped.push({ rowNumber, raw, reason: `Unrecognized date "${dateRaw.trim()}"` });
      return;
    }

    const startRaw = fields[columns.start] ?? "";
    const startTime = parseTime(startRaw);
    if (!startTime) {
      skipped.push({ rowNumber, raw, reason: `Unrecognized start time "${startRaw.trim()}"` });
      return;
    }

    let endTime: string | null = null;
    if (columns.end !== undefined) {
      const endRaw = fields[columns.end] ?? "";
      endTime = parseTime(endRaw); // silently null if unparseable — end time is optional
    }

    rows.push({ employeeName, date, startTime, endTime, raw });
  });

  return { rows, skipped, headers };
}

// ════════════════════════════════════ Shift-type matching ═══════════════════

export interface ShiftTimeRule {
  shiftId: number;
  shiftName: string;
  startFrom: string; // "HH:MM", inclusive
  startUntil: string; // "HH:MM", exclusive
}

/**
 * Finds which shift a start time belongs to, per the store's configured
 * time rules. Pure string comparison — "HH:MM" sorts correctly as a string
 * as long as both sides are zero-padded, which parseTime() guarantees.
 * Returns null if no rule covers the given start time.
 */
export function matchShiftType(startTime: string, rules: ShiftTimeRule[]): ShiftTimeRule | null {
  for (const rule of rules) {
    if (rule.startFrom <= rule.startUntil) {
      if (startTime >= rule.startFrom && startTime < rule.startUntil) return rule;
    } else {
      // Wraps past midnight (e.g. 22:00–02:00)
      if (startTime >= rule.startFrom || startTime < rule.startUntil) return rule;
    }
  }
  return null;
}

/**
 * Human-readable problems with a set of time windows, for the rules editor.
 *
 * A misconfigured window is otherwise invisible until after an import has
 * already filed people under the wrong shift — which is exactly how a store
 * ends up with every closer sitting in the "Mid" column. Overlaps matter
 * most: matchShiftType takes the first covering rule, so an overlap silently
 * hands the row to whichever window starts earlier.
 *
 * Gaps are reported too, but only inside the working span the rules already
 * cover — the hours before the first shift starts aren't a gap, they're just
 * closed.
 */
export function describeRuleProblems(rules: ShiftTimeRule[]): string[] {
  const sorted = [...rules].sort((a, b) => a.startFrom.localeCompare(b.startFrom));
  const problems: string[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    // Wrapping windows (a close that runs past midnight) legitimately reach
    // back past the others; comparing them linearly would cry wolf.
    if (cur.startFrom > cur.startUntil) continue;

    if (next.startFrom < cur.startUntil) {
      problems.push(
        `${cur.shiftName} (${cur.startFrom}–${cur.startUntil}) and ${next.shiftName} ` +
          `(${next.startFrom}–${next.startUntil}) overlap — a start between ${next.startFrom} ` +
          `and ${cur.startUntil} goes to ${cur.shiftName}.`
      );
    } else if (next.startFrom > cur.startUntil) {
      problems.push(
        `Nothing covers ${cur.startUntil}–${next.startFrom}, between ${cur.shiftName} and ${next.shiftName} — ` +
          `a shift starting in there won't import.`
      );
    }
  }

  return problems;
}
