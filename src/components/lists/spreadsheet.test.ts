import writeXlsxFile from "write-excel-file/universal";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  cellText,
  columnLetter,
  columnNames,
  columnValues,
  defaultColumn,
  looksLikeHeader,
  readSpreadsheet,
} from "./spreadsheet";

/**
 * The reader is exercised on real files: `.xlsx` workbooks are generated here
 * with `write-excel-file` (a dev dependency) rather than committed as binaries,
 * and read back through the same `read-excel-file` the app uses.
 */

const csv = (text: string, name = "list.csv") => new File([text], name, { type: "text/csv" });

async function workbook(
  sheets: { sheet: string; rows: (string | number | null)[][] }[],
  name = "list.xlsx",
): Promise<File> {
  const data = sheets.map(({ sheet, rows }) => ({
    sheet,
    data: rows.map((row) =>
      row.map((value) =>
        value === null ? null : typeof value === "number" ? { value } : { value },
      ),
    ),
  }));
  // The multi-sheet overload takes `[{ sheet, data }]`.
  const blob = await (writeXlsxFile as unknown as (s: unknown) => { toBlob(): Promise<Blob> })(
    data,
  ).toBlob();
  return new File([blob], name);
}

describe("cellText", () => {
  it("shows a value the way the sheet does", () => {
    expect(cellText("  T-1041 ")).toBe("T-1041");
    expect(cellText(12)).toBe("12");
    expect(cellText(2.5)).toBe("2.5");
    expect(cellText(true)).toBe("true");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(Number.NaN)).toBe("");
  });

  it("folds a line break inside a cell, which would otherwise become two items", () => {
    expect(cellText("Smith,\nJohn")).toBe("Smith, John");
    expect(cellText("a\r\n  b\n\nc")).toBe("a b c");
  });

  it("writes a date as a date, and adds the time only when there is one", () => {
    expect(cellText(new Date("2026-08-14T00:00:00.000Z"))).toBe("2026-08-14");
    expect(cellText(new Date("2026-08-14T09:30:15.000Z"))).toBe("2026-08-14T09:30:15Z");
    expect(cellText(new Date("not a date"))).toBe("");
  });
});

describe("readSpreadsheet: csv", () => {
  it("reads rows and trims cells, skipping blank lines", async () => {
    const [sheet] = await readSpreadsheet(csv("id,name\n T-1 , Alpha \n\nT-2,Beta\n"));
    expect(sheet.rows).toEqual([["id", "name"], ["T-1", "Alpha"], ["T-2", "Beta"]]);
    expect(sheet.name).toBe("list");
  });

  it("keeps a quoted value with a comma in it whole", async () => {
    const [sheet] = await readSpreadsheet(csv('name\n"Smith, John"\n"Doe, Jane"'));
    expect(sheet.rows).toEqual([["name"], ["Smith, John"], ["Doe, Jane"]]);
  });

  it("detects a semicolon or tab delimiter", async () => {
    const semicolons = await readSpreadsheet(csv("a;b\n1;2"));
    expect(semicolons[0].rows).toEqual([["a", "b"], ["1", "2"]]);
    const tabs = await readSpreadsheet(csv("a\tb\n1\t2", "list.tsv"));
    expect(tabs[0].rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("refuses an unterminated quote rather than importing what follows it", async () => {
    await expect(readSpreadsheet(csv('a,b\n"oops,1\nT-2,2'))).rejects.toThrow(/never closed/);
  });
});

describe("readSpreadsheet: txt", () => {
  it("is one item per line, and a comma inside a line stays in it", async () => {
    const [sheet] = await readSpreadsheet(csv("Smith, John\n\n  T-2  \r\nT-3", "names.txt"));
    expect(sheet.rows).toEqual([["Smith, John"], ["T-2"], ["T-3"]]);
  });
});

describe("readSpreadsheet: xlsx", () => {
  it("reads every sheet with its name, dropping empty rows", async () => {
    const sheets = await readSpreadsheet(
      await workbook([
        { sheet: "Terminals", rows: [["Terminal", "Country"], ["T-1041", "NG"], [null, null], ["T-1042", "US"]] },
        { sheet: "Accounts", rows: [["Account"], [1234567890]] },
      ]),
    );
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Terminals", "Accounts"]);
    expect(sheets[0].rows).toEqual([["Terminal", "Country"], ["T-1041", "NG"], ["T-1042", "US"]]);
    // A number cell arrives as text, without a trailing ".0".
    expect(sheets[1].rows).toEqual([["Account"], ["1234567890"]]);
  });

  it("says plainly when the file is not a workbook at all", async () => {
    const notReally = new File(["this is not a zip"], "fake.xlsx");
    await expect(readSpreadsheet(notReally)).rejects.toThrow(/could not be read as an Excel workbook/);
  });
});

describe("readSpreadsheet: refusals", () => {
  it("names the way out for an old .xls file", async () => {
    await expect(readSpreadsheet(new File(["x"], "old.xls"))).rejects.toThrow(/Save As.*\.xlsx or \.csv/);
  });

  it("refuses a type it cannot read, naming the ones it can", async () => {
    await expect(readSpreadsheet(new File(["x"], "list.pdf"))).rejects.toThrow(/\.pdf files are not supported/);
    await expect(readSpreadsheet(new File(["x"], "noextension"))).rejects.toThrow(/That file type is not supported/);
  });

  it("refuses a file over the size cap before reading it", async () => {
    const big = new File(["x"], "big.csv");
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    await expect(readSpreadsheet(big)).rejects.toThrow(/Import reads files up to 10 MB/);
  });

  it("refuses a sheet over the row cap instead of silently truncating it", async () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `T-${i}`).join("\n");
    await expect(readSpreadsheet(csv(lines, "long.txt"))).rejects.toThrow(/Import reads up to 200,000/);
  });

  it("says so when there is nothing in the file", async () => {
    await expect(readSpreadsheet(csv("\n\n  \n"))).rejects.toThrow(ImportError);
    await expect(readSpreadsheet(csv("\n\n"))).rejects.toThrow(/no data/);
  });
});

describe("picking a column", () => {
  const rows = [
    ["Terminal", "Country", "Note"],
    ["T-1", "NG", ""],
    ["T-2", "US", "pulled"],
    ["T-3", "GB", ""],
  ];

  it("guesses a heading row only when several columns and no number in it", () => {
    expect(looksLikeHeader(rows)).toBe(true);
    expect(looksLikeHeader([["1", "2"], ["3", "4"]])).toBe(false);
    expect(looksLikeHeader([["Terminal"], ["T-1"]])).toBe(false);
    expect(looksLikeHeader([["Terminal", "Count"]])).toBe(false);
    expect(looksLikeHeader([["", ""], ["a", "b"]])).toBe(false);
  });

  it("names columns by heading, falling back to a letter", () => {
    expect(columnNames(rows, true)).toEqual(["Terminal", "Country", "Note"]);
    expect(columnNames(rows, false)).toEqual(["Column A", "Column B", "Column C"]);
    expect(columnNames([["x", "", "z"]], true)).toEqual(["x", "Column B", "z"]);
  });

  it("numbers columns like a spreadsheet", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });

  it("takes the non-empty values below the heading, or all of them without one", () => {
    expect(columnValues(rows, 2, true)).toEqual(["pulled"]);
    expect(columnValues(rows, 0, true)).toEqual(["T-1", "T-2", "T-3"]);
    expect(columnValues(rows, 0, false)).toEqual(["Terminal", "T-1", "T-2", "T-3"]);
    // A short row is a missing cell, not a crash.
    expect(columnValues([["a", "b"], ["c"]], 1, false)).toEqual(["b"]);
  });

  it("opens on the fullest column, the first on a tie", () => {
    expect(defaultColumn(rows, true)).toBe(0);
    expect(defaultColumn([["", "a"], ["", "b"], ["x", "c"]], false)).toBe(1);
    expect(defaultColumn([["a", "b"], ["c", "d"]], false)).toBe(0);
  });
});
