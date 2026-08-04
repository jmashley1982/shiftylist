/**
 * Parses a Homebase weekly-schedule PDF export into the same
 * "Employee,Date,Start,End" CSV shape src/lib/homebaseCsv.ts already
 * understands, so the server-side importer needs no separate PDF code path.
 *
 * Runs entirely in the browser — pdf.js is loaded from cdnjs on demand, not
 * bundled into the Worker. Nothing here touches the network except that CDN
 * fetch; the parsed CSV is handed back to the caller to submit like any
 * other upload.
 *
 * Homebase's export is a grid (employee rows × day-of-week columns) with
 * blank cells simply omitted from the PDF's text stream — there is no
 * marker saying "this cell is empty." Reconstructing which date each shift
 * belongs to means reading the actual (x, y) position of every text run:
 *   1. Each logical value (a date, a name, an hrs total, a time range)
 *      already comes out of pdf.js as ONE atomic text item — verified
 *      against real exports, not assumed. There is no cross-item text
 *      fragmentation to reassemble, and — importantly — no safe way to
 *      merge items by proximity either: real column gaps run as tight as
 *      ~14pt, well inside what looks like a safe "same cell" threshold, so
 *      any gap-based merging silently glues adjacent cells together.
 *   2. The 7 items matching MM/DD/YYYY give the column x-positions and
 *      their real calendar dates.
 *   3. Each "N.NNhrs" item in the leftmost (employee-name) column marks a
 *      row; the nearest preceding item at that same left-hand x is the
 *      employee's name.
 *   4. Every item matching a time range (e.g. "5:00pm-12:30am") is
 *      assigned to whichever column's x it's nearest to, and whichever
 *      employee's name is nearest to it in y — nearest, not a fixed
 *      boundary window: a shift always sits ~1-3pt from its own row's
 *      name (both are the row's top line) but rows run ~30pt+ apart, so
 *      nearest-neighbor is robust without needing to hand-tune a cutoff,
 *      including rows with more lines than usual (e.g. two shifts stacked
 *      in one day for a meeting).
 *
 * Verified against 4 real weekly exports: every employee's extracted
 * shifts sum to exactly the hours total Homebase itself printed for them.
 */
window.ShiftListPdfSchedule = (function () {
  "use strict";

  var PDFJS_VERSION = "6.1.200";
  var PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/";
  var loaderPromise = null;

  function loadPdfJs() {
    if (!loaderPromise) {
      loaderPromise = import(PDFJS_BASE + "pdf.min.mjs").then(function (mod) {
        mod.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.mjs";
        return mod;
      });
    }
    return loaderPromise;
  }

  var DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  var HRS_RE = /^[\d.]+\s*hrs$/i;
  var RANGE_RE = /^(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)$/i;

  function toIsoDate(mmddyyyy) {
    var m = mmddyyyy.match(DATE_RE);
    return m ? m[3] + "-" + m[1] + "-" + m[2] : null;
  }

  function nearestColumn(columns, x) {
    var best = null;
    var bestDist = Infinity;
    columns.forEach(function (c) {
      var d = Math.abs(c.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    });
    return best;
  }

  function extractPageRows(items) {
    var columns = items
      .filter(function (it) {
        return DATE_RE.test(it.str);
      })
      .map(function (it) {
        return { x: it.x, isoDate: toIsoDate(it.str) };
      })
      .sort(function (a, b) {
        return a.x - b.x;
      });
    if (columns.length === 0) return [];

    var leftBoundary = columns[0].x - 8;

    // Items in reading order (top-to-bottom, left-to-right) so the
    // backward scan below finds the name immediately preceding each hrs
    // total, without picking up unrelated same-x content from other rows.
    var sorted = items.slice().sort(function (a, b) {
      return b.y - a.y || a.x - b.x;
    });

    var employees = [];
    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      if (it.x >= leftBoundary || !HRS_RE.test(it.str)) continue;
      var nameItem = null;
      for (var j = i - 1; j >= 0; j--) {
        if (sorted[j].x < leftBoundary && sorted[j].str && !HRS_RE.test(sorted[j].str)) {
          nameItem = sorted[j];
          break;
        }
        if (sorted[j].y < it.y - 20) break; // scanned past this row already — stop
      }
      if (nameItem) employees.push({ name: nameItem.str, y: nameItem.y });
    }
    if (employees.length === 0) return [];

    var rows = [];
    items.forEach(function (it) {
      var m = it.str.match(RANGE_RE);
      if (!m) return;
      var col = nearestColumn(columns, it.x);
      if (!col || !col.isoDate) return;

      var owner = null;
      var bestDist = Infinity;
      employees.forEach(function (e) {
        var d = Math.abs(it.y - e.y);
        if (d < bestDist) {
          bestDist = d;
          owner = e;
        }
      });
      if (!owner) return;

      rows.push({
        employeeName: owner.name,
        date: col.isoDate,
        start: m[1].replace(/\s+/g, ""),
        end: m[2].replace(/\s+/g, ""),
      });
    });
    return rows;
  }

  function toCsv(rows) {
    var lines = ["Employee,Date,Start,End"];
    rows.forEach(function (r) {
      lines.push(
        ['"' + r.employeeName.replace(/"/g, '""') + '"', '"' + r.date + '"', '"' + r.start + '"', '"' + r.end + '"'].join(
          ","
        )
      );
    });
    return lines.join("\n");
  }

  /** Reads a PDF File and returns { csvText, rowCount } ready for the same upload path as a CSV. */
  async function parsePdfToCsv(file) {
    var pdfjsLib = await loadPdfJs();
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    var allRows = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      var items = content.items
        .filter(function (it) {
          return "str" in it && it.str && it.str.trim();
        })
        .map(function (it) {
          return { str: it.str.trim(), x: it.transform[4], y: it.transform[5] };
        });
      allRows = allRows.concat(extractPageRows(items));
    }

    return { csvText: toCsv(allRows), rowCount: allRows.length };
  }

  return { parsePdfToCsv: parsePdfToCsv };
})();
