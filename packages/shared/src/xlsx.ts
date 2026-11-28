// Reads .xlsx and .csv files into the grids the import parser takes. A separate entry point
// (`@mecatol/shared/xlsx`) so only the import page loads SheetJS; the Worker never imports it.
import { read, SSF, utils, type CellObject, type WorkBook } from 'xlsx';
import type { Cell, SheetTab } from './import/parse.js';

const COLS = 8; // A–H; the parser ignores the rest

function toCell(cell: CellObject | undefined): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Date-formatted numbers are dates (serial day numbers). Read the parts from the serial so the
    // result doesn't depend on the browser's time zone.
    if (cell.z !== undefined && SSF.is_date(cell.z)) {
      const d = SSF.parse_date_code(cell.v);
      return { date: { year: d.y, month: d.m, day: d.d } };
    }
    return cell.v;
  }
  if (cell.t === 's' || cell.t === 'b') return cell.v as string | boolean;
  return null; // errors and anything else
}

function toTabs(wb: WorkBook, csvName: string | null): SheetTab[] {
  return wb.SheetNames.flatMap((name) => {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) return [];
    const range = utils.decode_range(ws['!ref']);
    const rows: Cell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < COLS; c++) row.push(toCell(ws[utils.encode_cell({ r, c })] as CellObject | undefined));
      rows.push(row);
    }
    return [{ name: csvName ?? name, rows }];
  });
}

/** Every tab of an .xlsx workbook, or the single tab of a .csv (named after the file). */
export function readSpreadsheet(data: ArrayBuffer, fileName: string): SheetTab[] {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    // raw: keep "5/21" and "8" as text; the parser recognizes dates and numbers itself.
    const wb = read(data, { type: 'array', raw: true, codepage: 65001 });
    return toTabs(wb, fileName.replace(/\.[^.]+$/, ''));
  }
  return toTabs(read(data, { type: 'array', cellNF: true, cellFormula: false, cellHTML: false }), null);
}
