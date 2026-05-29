/** Parse CSV text into rows (handles quoted fields with commas). */
export function parseCsvText(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const cols: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    return cols;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML document for embedding CSV in an iframe (avoids browser download of text/csv). */
export function csvToPreviewHtml(rows: string[][], maxRows = 500): string {
  const headers = rows[0] ?? [];
  const bodyRows = rows.slice(1, maxRows + 1);
  const headCells = headers
    .map(
      (h) =>
        `<th style="border:1px solid #dadce0;padding:8px 12px;text-align:left;font-weight:600;white-space:nowrap;background:#f1f3f4">${escapeHtml(h)}</th>`,
    )
    .join("");
  const bodyHtml = bodyRows
    .map((row, ri) => {
      const bg = ri % 2 === 0 ? "#fff" : "#f8f9fa";
      const cells = headers
        .map((_, ci) => {
          const v = row[ci] ?? "";
          return `<td style="border:1px solid #dadce0;padding:6px 12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:${bg}">${escapeHtml(v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const truncated =
    rows.length > maxRows + 1
      ? `<p style="margin:12px 16px;font:13px system-ui,sans-serif;color:#5f6368">Showing first ${maxRows} rows.</p>`
      : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CSV preview</title></head>
<body style="margin:0;font:12px system-ui,sans-serif;color:#202124">
<div style="overflow:auto;height:100vh;box-sizing:border-box;padding:8px">
<table style="border-collapse:collapse;min-width:100%"><thead><tr>${headCells}</tr></thead><tbody>${bodyHtml}</tbody></table>
${truncated}
</div></body></html>`;
}
