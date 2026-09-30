/**
 * Reading a list's items out of a spreadsheet.
 *
 * Everything happens in the browser: the file is parsed here and only the
 * chosen column of text is ever sent to the engine, as ordinary list items. A
 * watchlist is often a column pulled out of a bigger export, so the flow is
 * "read every sheet, let the person pick the sheet and column".
 *
 * `.xlsx` is read with `read-excel-file`, CSV and TSV with `papaparse`. Both are
 * imported on demand so the lists pages do not carry a zip reader and a CSV
 * parser for the majority of visits that never import anything. (SheetJS's
 * `xlsx` is not used: the npm package is an unmaintained 0.18.5 with published
 * prototype-pollution and ReDoS advisories, which is a poor thing to point at a
 * file someone downloaded from somewhere.)
 *
 * A file is untrusted input. It is size-capped before it is read, each sheet is
 * row-capped after, and every failure is turned into one sentence a person can
 * act on rather than a library's stack.
 */

/** Refused before reading. A spreadsheet of identifiers is kilobytes; ten
 *  megabytes is an export of something else, or a zip bomb. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Rows per sheet. Far above the engine's own item cap (20,000 by default), so
 *  a long list imports and the engine, not this reader, names the limit. */
export const MAX_IMPORT_ROWS = 200_000;

/** What the file picker offers. The extension decides the reader, not this. */
export const ACCEPT = ".xlsx,.csv,.tsv,.txt";

/** One sheet as rows of trimmed text. Missing cells are empty strings. */
export interface ParsedSheet {
  name: string;
  rows: string[][];
}

/** A failure whose message is fit to show as it stands. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * One cell as the text an analyst would see in it.
 *
 * Numbers lose their trailing ".0" the way the spreadsheet displays them, dates
 * become `YYYY-MM-DD` (with the time when there is one) rather than a locale
 * string, and empty and null cells are empty.
 */
export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return "";
    const iso = cell.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
  }
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  // A cell can hold a line break. Left in, it would later be split into two
  // items by the one-item-per-line rule, so it is folded into a single space.
  return String(cell)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function capRows(sheets: ParsedSheet[]): ParsedSheet[] {
  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_IMPORT_ROWS) {
      throw new ImportError(
        `"${sheet.name}" has ${sheet.rows.length.toLocaleString()} rows. Import reads up to ${MAX_IMPORT_ROWS.toLocaleString()}: split the file or keep only the column you need.`,
      );
    }
  }
  return sheets;
}

/**
 * Drop rows with nothing in them. A sheet often carries formatting far below
 * its data, and those rows are not items.
 */
function nonEmptyRows(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => cell !== ""));
}

async function readXlsx(file: File): Promise<ParsedSheet[]> {
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    // `universal`, not `browser`: the browser build spawns a Web Worker, which
    // the bundler would have to be taught about for no benefit on a file this
    // size.
    const { default: readXlsxFile } = await import("read-excel-file/universal");
    sheets = (await readXlsxFile(file)) as unknown as typeof sheets;
  } catch {
    throw new ImportError(
      "That file could not be read as an Excel workbook. It may be corrupt, password protected, or not really an .xlsx file. Try saving it again as .xlsx or .csv.",
    );
  }
  return sheets.map(({ sheet, data }) => ({
    name: sheet,
    rows: nonEmptyRows(data.map((row) => row.map(cellText))),
  }));
}

async function readCsv(file: File): Promise<ParsedSheet[]> {
  const text = await file.text();
  const { default: Papa } = await import("papaparse");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  // `parse` reports recoverable oddities (a ragged row) as errors and still
  // returns the data; only an unterminated quote corrupts what follows it.
  if (parsed.errors.some((error) => error.type === "Quotes")) {
    throw new ImportError(
      "A quoted value in that file is never closed, so the rows after it cannot be trusted. Fix the quote and try again.",
    );
  }
  return [
    {
      name: baseName(file.name),
      rows: nonEmptyRows(parsed.data.map((row) => row.map(cellText))),
    },
  ];
}

/** A plain text file is one item per line; commas inside a line stay in it. */
async function readLines(file: File): Promise<ParsedSheet[]> {
  const text = await file.text();
  return [
    {
      name: baseName(file.name),
      rows: text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => [line]),
    },
  ];
}

/**
 * Read a spreadsheet or delimited text file into sheets of text.
 *
 * Throws `ImportError` with a message meant to be shown as it stands.
 */
export async function readSpreadsheet(file: File): Promise<ParsedSheet[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Import reads files up to ${MAX_FILE_BYTES / (1024 * 1024)} MB: keep only the column you need and save it again.`,
    );
  }

  const extension = extensionOf(file.name);
  let sheets: ParsedSheet[];
  switch (extension) {
    case "xlsx":
      sheets = await readXlsx(file);
      break;
    case "csv":
    case "tsv":
      sheets = await readCsv(file);
      break;
    case "txt":
      sheets = await readLines(file);
      break;
    case "xls":
      throw new ImportError(
        "Old .xls workbooks are not supported. In Excel use Save As and choose .xlsx or .csv.",
      );
    default:
      throw new ImportError(
        `${extension ? `.${extension} files are` : "That file type is"} not supported. Use .xlsx, .csv, .tsv or .txt.`,
      );
  }

  capRows(sheets);
  const usable = sheets.filter((sheet) => sheet.rows.length > 0);
  if (usable.length === 0) {
    throw new ImportError("That file has no data in it.");
  }
  return usable;
}

/** Whether a cell reads as a number, which a column heading almost never does. */
function looksNumeric(text: string): boolean {
  return /^[+-]?(\d[\d,_ ]*)?\.?\d+(?:[eE][+-]?\d+)?$/.test(text.replaceAll(" ", ""));
}

/**
 * A guess at whether row one is column headings.
 *
 * Only made for a sheet with several columns, where headings are the norm and
 * data rows mix kinds. With a single column the first line is as likely to be
 * the first item as a title, so the answer is no and the preview shows it: one
 * tick puts it right, and guessing "yes" would silently drop a real item.
 */
export function looksLikeHeader(rows: readonly string[][]): boolean {
  if (rows.length < 2) return false;
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 2) return false;
  const first = rows[0].filter((cell) => cell !== "");
  if (first.length === 0) return false;
  return first.every((cell) => !looksNumeric(cell));
}

/** Spreadsheet-style column letters: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** Names for the column picker: the heading when there is one, else "Column B". */
export function columnNames(rows: readonly string[][], hasHeader: boolean): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, index) => {
    const heading = hasHeader ? (rows[0]?.[index] ?? "") : "";
    return heading !== "" ? heading : `Column ${columnLetter(index)}`;
  });
}

/** The non-empty values of one column, below the heading when there is one. */
export function columnValues(
  rows: readonly string[][],
  index: number,
  hasHeader: boolean,
): string[] {
  const values: string[] = [];
  for (let rowIndex = hasHeader ? 1 : 0; rowIndex < rows.length; rowIndex += 1) {
    const value = rows[rowIndex]?.[index] ?? "";
    if (value !== "") values.push(value);
  }
  return values;
}

/**
 * Which column to offer first: the one with the most values, the first such
 * column on a tie. A sheet that opens with an empty spacer column or a sparse
 * notes column should not land on it.
 */
export function defaultColumn(rows: readonly string[][], hasHeader: boolean): number {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let best = 0;
  let bestCount = -1;
  for (let index = 0; index < width; index += 1) {
    const count = columnValues(rows, index, hasHeader).length;
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  return best;
}
