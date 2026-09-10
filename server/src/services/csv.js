// Minimal CSV writer — no library (CLAUDE.md: don't add dependencies for
// something this small). RFC-4180-ish: a field is quoted only if it
// contains a comma, a quote or a newline; embedded quotes are doubled;
// rows are joined with CRLF. Dates go out as ISO 8601.

const cell = value => {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * @param columns [{ key, header?, value? }] — `value(row)` overrides `row[key]`; `header` overrides `key`.
 * @param rows    array of plain objects
 */
export const toCsv = (columns, rows) => {
  const head = columns.map(c => cell(c.header ?? c.key)).join(",");
  const body = rows.map(row => columns.map(c => cell(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
};

// The include-excluded / include-practice choices go IN the filename so
// two exports can never be confused (SPEC §11). e.g.
//   participants__excluded-out__practice-out__2026-09-10.csv
//   responses__excluded-in__practice-in__session-a3f9c1__arm-E__2026-09-10.csv
export const exportFilename = (base, { includeExcluded, includePractice, sessionId, arm }) => {
  const parts = [base, `excluded-${includeExcluded ? "in" : "out"}`, `practice-${includePractice ? "in" : "out"}`];
  if (sessionId) parts.push(`session-${String(sessionId).slice(-6)}`);
  if (arm) parts.push(`arm-${arm}`);
  parts.push(new Date().toISOString().slice(0, 10));
  return `${parts.join("__")}.csv`;
};
