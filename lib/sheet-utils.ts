import * as XLSX from "xlsx";

/**
 * Shrink a sheet's declared range to where cells actually exist.
 *
 * A workbook can declare a huge range (formatting a whole column makes Excel declare a million
 * rows; a tiny crafted file can claim A1:XFD1048576). sheet_to_json and any loop over the
 * declared range then allocate every empty row and column — a few KB of file turns into
 * hundreds of MB of memory. Real data is untouched: the range's start corner is kept and its
 * end is clamped to the last cell that exists.
 */
export function trimSheetToData(sheet: XLSX.WorkSheet): void {
  const ref = sheet["!ref"];
  if (!ref) return;
  const declared = XLSX.utils.decode_range(ref);
  let maxR = -1;
  let maxC = -1;
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) {
    sheet["!ref"] = XLSX.utils.encode_range(declared.s, declared.s);
    return;
  }
  sheet["!ref"] = XLSX.utils.encode_range(declared.s, {
    r: Math.min(declared.e.r, maxR),
    c: Math.min(declared.e.c, maxC),
  });
}
