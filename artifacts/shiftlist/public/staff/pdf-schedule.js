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
 * belongs to means reading the actual (x, y) position of every text run on
 * the page, not just its reading order:
 *   1. Cluster text runs into visual lines (same y, x-adjacent — a big x
 *      gap means a different table cell, not a continuation of one line).
 *   2. The 7 header lines matching MM/DD/YYYY give the column x-positions
 *      and their real calendar dates.
 *   3. Each "N.NNhrs" line sitting in the leftmost (employee-name) column
 *      marks a row; the nearest text line above it at that same left-hand
 *      x is the employee's name.
 *   4. Any line matching a time range (e.g. "5:00pm-12:30am") is assigned
 *      to whichever employee's row band contains its y, and whichever
 *      column's x it's nearest to.
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
  var CELL_GAP = 20; // pt — bigger than any real word-space, smaller than any column gap

  function toIsoDate(mmddyyyy) {
    var m = mmddyyyy.match(DATE_RE);
    return m ? m[3] + "-" + m[1] + "-" + m[2] : null;
  }

  /** Groups raw text items into visual lines using real (x, y) geometry, not stream order. */
  function clusterLines(items) {
    var sorted = items.slice().sort(function (a, b) {
      return b.y - a.y || a.x - b.x;
    });
    var lines = [];
    sorted.forEach(function (it) {
      var line = lines[lines.length - 1];
      var last = line ? line.items[line.items.length - 1] : null;
      var sameY = line && Math.abs(line.y - it.y) <= 2.5;
      var adjacent = last && it.x - (last.x + last.width) < CELL_GAP;
      if (sameY && adjacent) {
        line.items.push(it);
        line.y = (line.y + it.y) / 2;
      } else {
        lines.push({ y: it.y, items: [it] });
      }
    });
    lines.forEach(function (line) {
      line.x = line.items[0].x;
      line.text = line.items
        .map(function (it) {
          return it.str;
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    });
    return lines;
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

  async function extractPageRows(page) {
    var content = await page.getTextContent();
    var items = content.items
      .filter(function (it) {
        return it.str && it.str.trim();
      })
      .map(function (it) {
        return { str: it.str.trim(), x: it.transform[4], y: it.transform[5], width: it.width || 0 };
      });
    var lines = clusterLines(items);

    var columns = lines
      .filter(function (l) {
        return DATE_RE.test(l.text);
      })
      .map(function (l) {
        return { x: l.x, isoDate: toIsoDate(l.text) };
      })
      .sort(function (a, b) {
        return a.x - b.x;
      });
    if (columns.length === 0) return [];

    var leftBoundary = columns[0].x - 8;

    // An "N.NNhrs" line in the name column marks an employee row; the
    // nearest preceding line at that same left-hand x is their name.
    var employees = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.x >= leftBoundary || !HRS_RE.test(line.text)) continue;
      var nameLine = null;
      for (var j = i - 1; j >= 0; j--) {
        if (lines[j].x < leftBoundary && lines[j].text && !HRS_RE.test(lines[j].text)) {
          nameLine = lines[j];
          break;
        }
        if (lines[j].y < line.y - 20) break; // scanned past this row already — stop
      }
      if (nameLine) employees.push({ name: nameLine.text, y: nameLine.y });
    }
    employees.sort(function (a, b) {
      return b.y - a.y;
    });
    if (employees.length === 0) return [];

    var rows = [];
    lines.forEach(function (line) {
      var m = line.text.match(RANGE_RE);
      if (!m) return;
      var col = nearestColumn(columns, line.x);
      if (!col || !col.isoDate) return;

      var owner = null;
      for (var k = 0; k < employees.length; k++) {
        var top = employees[k].y;
        var bottom = k + 1 < employees.length ? employees[k + 1].y : -Infinity;
        if (line.y <= top + 2 && line.y > bottom) {
          owner = employees[k];
          break;
        }
      }
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
      var pageRows = await extractPageRows(page);
      allRows = allRows.concat(pageRows);
    }

    return { csvText: toCsv(allRows), rowCount: allRows.length };
  }

  return { parsePdfToCsv: parsePdfToCsv };
})();
