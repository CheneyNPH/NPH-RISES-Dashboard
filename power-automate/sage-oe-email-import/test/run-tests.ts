// Offline tests for BuildSageOEImport.ts. Runs the real script against an in-memory
// workbook that behaves like ExcelScript (including its "values must match the range
// size" rule), then checks what ended up on the Orders / Order_Details sheets.
//
//   cd power-automate/sage-oe-email-import/test && ./run-tests.sh

declare function require(name: string): any;
declare const console: { log(...args: unknown[]): void };
declare const process: { exitCode: number; argv: string[] };
declare const __dirname: string; // test/build, where the combined script runs

const fs = require("fs");

type Cell = string | number | boolean;

class FakeWorkbook implements ExcelScript.Workbook {
  sheets: FakeSheet[] = [];
  constructor(names: string[]) {
    names.forEach((n) => this.addWorksheet(n));
  }
  getWorksheet(name: string): ExcelScript.Worksheet | undefined {
    return this.sheets.filter((s) => s.name === name)[0];
  }
  getWorksheets(): ExcelScript.Worksheet[] {
    return this.sheets.slice();
  }
  addWorksheet(name?: string): ExcelScript.Worksheet {
    const sheet = new FakeSheet(this, name || `Sheet${this.sheets.length + 1}`);
    this.sheets.push(sheet);
    return sheet;
  }
  dump(): { name: string; rows: Cell[][]; formats: string[][] }[] {
    return this.sheets.map((s) => ({ name: s.name, rows: s.grid(), formats: s.formatGrid() }));
  }
}

class FakeSheet implements ExcelScript.Worksheet {
  cells: { [key: string]: Cell } = {};
  formats: { [key: string]: string } = {};
  bold: { [key: string]: boolean } = {};
  constructor(public book: FakeWorkbook, public name: string) {}
  getName(): string { return this.name; }
  setPosition(position: number): void {
    const list = this.book.sheets.filter((s) => s !== this);
    list.splice(position, 0, this);
    this.book.sheets = list;
  }
  delete(): void {
    if (this.book.sheets.length === 1) { throw new Error("Cannot delete the only worksheet"); }
    this.book.sheets = this.book.sheets.filter((s) => s !== this);
  }
  getRange(address?: string): ExcelScript.Range {
    if (address) { throw new Error("fake only supports getRange() for the whole sheet"); }
    return new FakeRange(this, 0, 0, 1048576, 16384);
  }
  getRangeByIndexes(r: number, c: number, rows: number, cols: number): ExcelScript.Range {
    return new FakeRange(this, r, c, rows, cols);
  }
  grid(): Cell[][] {
    const keys = Object.keys(this.cells).map((k) => k.split(",").map(Number));
    const maxR = Math.max(-1, ...keys.map((k) => k[0]));
    const maxC = Math.max(-1, ...keys.map((k) => k[1]));
    const out: Cell[][] = [];
    for (let r = 0; r <= maxR; r++) {
      const row: Cell[] = [];
      for (let c = 0; c <= maxC; c++) { row.push(this.cells[`${r},${c}`] === undefined ? "" : this.cells[`${r},${c}`]); }
      out.push(row);
    }
    return out;
  }
  formatGrid(): string[][] {
    return this.grid().map((row, r) => row.map((_, c) => this.formats[`${r},${c}`] || ""));
  }
}

class FakeRange implements ExcelScript.Range {
  constructor(public sheet: FakeSheet, public r: number, public c: number, public rows: number, public cols: number) {}
  clear(): void {
    if (this.r !== 0 || this.c !== 0 || this.rows < 1048576) { throw new Error("fake only clears whole sheets"); }
    this.sheet.cells = {}; this.sheet.formats = {}; this.sheet.bold = {};
  }
  setValues(values: Cell[][]): void {
    if (values.length !== this.rows || values.some((row) => row.length !== this.cols)) {
      throw new Error(`setValues: ${values.length}x${values[0] ? values[0].length : 0} values for a ${this.rows}x${this.cols} range`);
    }
    values.forEach((row, i) => row.forEach((v, j) => { this.sheet.cells[`${this.r + i},${this.c + j}`] = v; }));
  }
  setNumberFormatLocal(fmt: string): void {
    this.each((k) => { this.sheet.formats[k] = fmt; });
  }
  getFormat(): ExcelScript.RangeFormat {
    const range = this;
    return {
      autofitColumns(): void {},
      getFont(): ExcelScript.RangeFont {
        return { setBold(b: boolean): void { range.each((k) => { range.sheet.bold[k] = b; }); } };
      },
    };
  }
  each(fn: (key: string) => void): void {
    for (let i = 0; i < this.rows; i++) { for (let j = 0; j < this.cols; j++) { fn(`${this.r + i},${this.c + j}`); } }
  }
}

// ------------- helpers -------------

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

function sheetRows(book: FakeWorkbook, name: string): Cell[][] {
  const s = book.sheets.filter((x) => x.name === name)[0];
  return s ? s.grid() : [];
}

/** Turns a sheet into [{FIELD: value}] so tests read like the import file. */
function records(book: FakeWorkbook, name: string): { [field: string]: Cell }[] {
  const rows = sheetRows(book, name);
  return rows.slice(1).map((row) => {
    const rec: { [field: string]: Cell } = {};
    rows[0].forEach((h, i) => { rec[String(h)] = row[i]; });
    return rec;
  });
}

function run(body: string, subject: string, sender: string, received: string, sheets: string[] = ["Orders", "Order_Details"]) {
  const book = new FakeWorkbook(sheets);
  const result = main(book, body, subject, sender, received);
  return { book, result };
}

const serial = (iso: string) => excelDate(iso);

// ------------- tests -------------

console.log("HTML email (Outlook table, samples/order-email.html)");
{
  const html = fs.readFileSync(__dirname + "/../../samples/order-email.html", "utf8");
  const { book, result } = run(html, "PO 45-10872 - new order", "rblack@example.com", "2026-10-19");
  check("status", result.status, "READY");
  check("issues", result.issues, "");
  check("sheet order", book.sheets.map((s) => s.name), ["Orders", "Order_Details"]);
  check("Orders row", records(book, "Orders"), [{
    ORDUNIQ: 1, ORDNUMBER: "*** NEW ***", CUSTOMER: "1200", SHIPTO: "WHSE2", PONUMBER: "45-10872",
    ORDDATE: serial("2026-10-16"), EXPDATE: serial("2026-10-30"),
    REFERENCE: "PO 45-10872 - new order", DESC: "Email order from rblack@example.com",
    COMMENT: "Call receiving 30 min before delivery & use dock 4.",
  }]);
  check("Order_Details rows", records(book, "Order_Details"), [
    { ORDUNIQ: 1, LINENUM: 32, LINETYPE: 1, ITEM: "A1-103/0", QTYORDERED: 12, ORDUNIT: "EA" },
    { ORDUNIQ: 1, LINENUM: 64, LINETYPE: 1, ITEM: "A1-105/0", QTYORDERED: 1200, ORDUNIT: "EA" },
  ]);
  const orders = book.sheets[0];
  check("date cells formatted as dates", [orders.formats["1,5"], orders.formats["1,6"]], ["yyyy-mm-dd", "yyyy-mm-dd"]);
  check("summary mentions email prices", /45\.00/.test(result.summaryHtml) && /3\.25/.test(result.summaryHtml), true);
  fs.writeFileSync(__dirname + "/sample-output.json", JSON.stringify(book.dump(), null, 2));
}

console.log("Plain-text email with space-aligned columns (samples/order-email.txt)");
{
  const text = fs.readFileSync(__dirname + "/../../samples/order-email.txt", "utf8");
  const { book, result } = run(text, "New order", "buyer@bargainmart.example", "2026-10-19");
  check("status", result.status, "READY");
  check("Orders row", records(book, "Orders"), [{
    ORDUNIQ: 1, ORDNUMBER: "*** NEW ***", CUSTOMER: "1100", PONUMBER: "77311",
    ORDDATE: serial("2026-10-19"), EXPDATE: serial("2026-11-04"),
    REFERENCE: "New order", DESC: "Email order from buyer@bargainmart.example", COMMENT: "Partial shipments OK",
  }]);
  check("Order_Details rows", records(book, "Order_Details"), [
    { ORDUNIQ: 1, LINENUM: 32, LINETYPE: 1, ITEM: "A1-103/0", QTYORDERED: 6 },
    { ORDUNIQ: 1, LINENUM: 64, LINETYPE: 1, ITEM: "A1-450/0", QTYORDERED: 2 },
  ]);
}

console.log("Space-aligned table typed into an Outlook HTML email (&nbsp; runs)");
{
  const body =
    '<div><p class=MsoNormal>Account #: 1100<o:p></o:p></p>\n  <p class=MsoNormal>PO #: 77311<o:p></o:p></p>\n' +
    '<p class=MsoNormal>Item<span style="mso-spacerun:yes">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span>Qty&nbsp;&nbsp;&nbsp; UOM<o:p></o:p></p>\n' +
    '<p class=MsoNormal>A1-103/0&nbsp;&nbsp; 6&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; EA<o:p></o:p></p>\n' +
    '<p class=MsoNormal>A1-450/0&nbsp;&nbsp; 2&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; EA<o:p></o:p></p></div>';
  const { book, result } = run(body, "Order", "x@y.com", "2026-10-19");
  check("status", result.status, "READY");
  check("lines", records(book, "Order_Details").map((r) => [r.ITEM, r.QTYORDERED, r.ORDUNIT]), [["A1-103/0", 6, "EA"], ["A1-450/0", 2, "EA"]]);
}

console.log("Pipe table, PO only in subject, unit inside the qty cell, default Sheet1");
{
  const body = [
    "Customer No: bm-1100",
    "",
    "| SKU | Qty | Price |",
    "|-----|-----|-------|",
    "| a1-103/0 | 4 cs | 45.00 |",
    "| A1-105/0 | 10 ea | 3.25 |",
    "",
    "Subtotal 212.50",
  ].join("\n");
  const { book, result } = run(body, "RE: PO# 99812 order", "x@y.com", "2026-10-19", ["Sheet1"]);
  check("status", result.status, "READY");
  check("PO from subject", result.poNumber, "99812");
  check("customer upper-cased", result.customer, "BM-1100");
  check("only import sheets remain", book.sheets.map((s) => s.name), ["Orders", "Order_Details"]);
  check("Order_Details rows", records(book, "Order_Details"), [
    { ORDUNIQ: 1, LINENUM: 32, LINETYPE: 1, ITEM: "A1-103/0", QTYORDERED: 4, ORDUNIT: "CS" },
    { ORDUNIQ: 1, LINENUM: 64, LINETYPE: 1, ITEM: "A1-105/0", QTYORDERED: 10, ORDUNIT: "EA" },
  ]);
}

console.log("One item per line (no table), unit on some lines only");
{
  const body = "<p>Acct #: 1200</p><p>PO: 5501</p><p>Item: A1-103/0 Qty: 3 EA</p><p>Item: A1-105/0 Qty: 7</p>";
  const { book, result } = run(body, "Order", "x@y.com", "2026-10-19");
  check("status", result.status, "REVIEW");
  check("lines", records(book, "Order_Details").map((r) => [r.ITEM, r.QTYORDERED, r.ORDUNIT]), [["A1-103/0", 3, "EA"], ["A1-105/0", 7, ""]]);
  check("mixed units flagged", /ORDUNIT/.test(result.issues), true);
}

console.log("Email the script cannot read");
{
  const { book, result } = run("<p>Hi, please see the attached PO. Thanks!</p>", "Order attached", "x@y.com", "2026-10-19");
  check("status", result.status, "REVIEW");
  check("issues", result.issues.split("\n").length, 3);
  check("customer flagged", /Customer number not found/.test(result.issues), true);
  check("no lines flagged", /No line items/.test(result.issues), true);
  check("header still written", records(book, "Orders")[0].ORDNUMBER, "*** NEW ***");
  check("details sheet has header only", sheetRows(book, "Order_Details"), [["ORDUNIQ", "LINENUM", "LINETYPE", "ITEM", "QTYORDERED"]]);
}

console.log("Bad values are flagged, not imported");
{
  const body = "Customer #: 1200\nPO: 1\nOrder Date: someday\nItem\tQty\nA1-103/0\tfive\nA1-105/0\t2";
  const { book, result } = run(body, "", "", "2026-10-19");
  check("status", result.status, "REVIEW");
  check("bad date falls back to received date", records(book, "Orders")[0].ORDDATE, serial("2026-10-19"));
  check("bad qty row skipped", records(book, "Order_Details").map((r) => r.ITEM), ["A1-105/0"]);
  check("both flagged", /someday/.test(result.issues) && /skipped/.test(result.issues), true);
}

console.log("Date parsing");
check("ISO", parseDate("2026-10-19"), "2026-10-19");
check("US slash", parseDate("10/19/2026"), "2026-10-19");
check("US short year", parseDate("10/19/26"), "2026-10-19");
check("month name", parseDate("Monday, October 19th, 2026"), "2026-10-19");
check("day-month-year", parseDate("19-Oct-2026"), "2026-10-19");
check("text around date", parseDate("by 11/4/2026 (ASAP)"), "2026-11-04");
check("impossible date", parseDate("2026-02-30"), "");
check("no date", parseDate("ASAP"), "");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
