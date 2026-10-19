// Offline tests for BuildSageOEImport.ts. Runs the real script against an in-memory
// workbook that behaves like ExcelScript (including its "values must match the range
// size" rule), then checks the import rows and the CSV it produces.
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
  getWorksheets(): ExcelScript.Worksheet[] {
    return this.sheets.slice();
  }
  add(name: string, rows: Cell[][]): FakeSheet {
    const sheet = new FakeSheet(name);
    rows.forEach((row, r) => row.forEach((v, c) => { sheet.cells[`${r},${c}`] = v; }));
    this.sheets.push(sheet);
    return sheet;
  }
}

class FakeSheet implements ExcelScript.Worksheet {
  cells: { [key: string]: Cell } = {};
  formats: { [key: string]: string } = {};
  constructor(public name: string) {}
  getRange(address?: string): ExcelScript.Range {
    if (address) { throw new Error("fake only supports getRange() for the whole sheet"); }
    return new FakeRange(this, 0, 0, 1048576, 16384);
  }
  getRangeByIndexes(r: number, c: number, rows: number, cols: number): ExcelScript.Range {
    if (rows < 1 || cols < 1) { throw new Error(`getRangeByIndexes: empty range ${rows}x${cols}`); }
    return new FakeRange(this, r, c, rows, cols);
  }
  getUsedRange(valuesOnly?: boolean): ExcelScript.Range {
    // Like Excel: the box around non-empty cells, or A1 when the sheet is blank.
    const keys = Object.keys(this.cells).filter((k) => this.cells[k] !== "").map((k) => k.split(",").map(Number));
    if (keys.length === 0) { return new FakeRange(this, 0, 0, 1, 1); }
    const r0 = Math.min(...keys.map((k) => k[0]));
    const c0 = Math.min(...keys.map((k) => k[1]));
    return new FakeRange(this, r0, c0, Math.max(...keys.map((k) => k[0])) - r0 + 1, Math.max(...keys.map((k) => k[1])) - c0 + 1);
  }
  grid(): Cell[][] {
    const used = this.getUsedRange(true) as FakeRange;
    return Object.keys(this.cells).length === 0 ? [] : new FakeRange(this, 0, 0, used.r + used.rows, used.c + used.cols).getValues();
  }
}

class FakeRange implements ExcelScript.Range {
  constructor(public sheet: FakeSheet, public r: number, public c: number, public rows: number, public cols: number) {}
  clear(): void {
    for (const k of Object.keys(this.sheet.cells)) {
      const [r, c] = k.split(",").map(Number);
      if (r >= this.r && r < this.r + this.rows && c >= this.c && c < this.c + this.cols) {
        delete this.sheet.cells[k];
        delete this.sheet.formats[k];
      }
    }
  }
  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let i = 0; i < this.rows; i++) {
      const row: Cell[] = [];
      for (let j = 0; j < this.cols; j++) {
        const v = this.sheet.cells[`${this.r + i},${this.c + j}`];
        row.push(v === undefined ? "" : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(values: Cell[][]): void {
    if (values.length !== this.rows || values.some((row) => row.length !== this.cols)) {
      throw new Error(`setValues: ${values.length}x${values[0] ? values[0].length : 0} values for a ${this.rows}x${this.cols} range`);
    }
    values.forEach((row, i) => row.forEach((v, j) => { this.sheet.cells[`${this.r + i},${this.c + j}`] = v; }));
  }
  setNumberFormatLocal(fmt: string): void {
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) { this.sheet.formats[`${this.r + i},${this.c + j}`] = fmt; }
    }
  }
  getRowIndex(): number { return this.r; }
  getColumnIndex(): number { return this.c; }
  getFormat(): ExcelScript.RangeFormat {
    return {
      autofitColumns(): void {},
      getFont(): ExcelScript.RangeFont { return { setBold(): void {} }; },
    };
  }
}

// ───────────── helpers ─────────────

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

// The header row of the Intacct Order Entry import template from NPH's company
// (Sage-OrderEntry_Import_headers.csv), plus the blank row that file had under it.
const TEMPLATE_HEADERS = ["TRANSACTIONTYPE", "DATE", "GLPOSTINGDATE", "CUSTOMER_ID", "DATEDUE", "DEPARTMENTID",
  "LOCATIONID", "LINE", "ITEMID", "PRICE", "REFERENCENO", "STATE", "CLASSID", "MEMO"];
const TEMPLATE: Cell[][] = [TEMPLATE_HEADERS, TEMPLATE_HEADERS.map(() => "")];

// Rows as Power Automate's "List rows present in a table" returns them from Customer_Map.xlsx.
const MAP_ROWS = [
  { "@odata.etag": "", ItemInternalId: "a1", "Customer ID": "C-1001", "Customer Name": "Northwind Traders, Inc.",
    "Sender Emails": "jane.ortiz@northwind.example; ap@northwind.example", "Sender Domains": "northwind.example", "Other Names or Codes": "NWT" },
  { "@odata.etag": "", ItemInternalId: "a2", "Customer ID": "C-1002", "Customer Name": "Bargain Mart",
    "Sender Emails": "", "Sender Domains": "", "Other Names or Codes": "1100; BMART" },
  { "@odata.etag": "", ItemInternalId: "a3", "Customer ID": "C-2001", "Customer Name": "Contoso Retail East",
    "Sender Emails": "east.buyer@contoso.example", "Sender Domains": "contoso.example", "Other Names or Codes": "" },
  { "@odata.etag": "", ItemInternalId: "a4", "Customer ID": "C-2002", "Customer Name": "Contoso Retail West",
    "Sender Emails": "", "Sender Domains": "contoso.example", "Other Names or Codes": "" },
];
const MAP_JSON = JSON.stringify(MAP_ROWS);

function run(body: string, opts: { subject?: string; sender?: string; map?: string; template?: Cell[][] } = {}) {
  const book = new FakeWorkbook();
  const sheet = book.add("OrderEntry_Import", opts.template || TEMPLATE);
  const result = main(book, body, opts.subject === undefined ? "Order" : opts.subject,
    opts.sender === undefined ? "someone@unknown.example" : opts.sender, "2026-10-19", opts.map === undefined ? MAP_JSON : opts.map);
  return { book, sheet, result };
}

/** Parses the script's CSV back into records keyed by header, the way Intacct will read it. */
function csvRecords(csv: string): { [column: string]: string }[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cellText = "";
  let quoted = false;
  const text = csv.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cellText += '"'; i++; } else if (ch === '"') { quoted = false; } else { cellText += ch; }
    } else if (ch === '"') { quoted = true; }
    else if (ch === ",") { row.push(cellText); cellText = ""; }
    else if (ch === "\r") { /* part of \r\n */ }
    else if (ch === "\n") { row.push(cellText); rows.push(row); row = []; cellText = ""; }
    else { cellText += ch; }
  }
  return rows.slice(1).map((r) => {
    const rec: { [column: string]: string } = {};
    rows[0].forEach((h, i) => { rec[h] = r[i]; });
    return rec;
  });
}

function pick(records: { [column: string]: string }[], columns: string[]): string[][] {
  return records.map((r) => columns.map((c) => r[c]));
}

const serial = (iso: string) => excelDate(iso);

// ───────────── tests ─────────────

console.log("HTML invoice email (Outlook table, no quantities, samples/order-email.html) on NPH's template");
{
  const html = fs.readFileSync(__dirname + "/../../samples/order-email.html", "utf8");
  const { sheet, result } = run(html, { subject: "PO 45-10872 - new order", sender: "jane.ortiz@northwind.example" });
  check("customer from sender address", [result.customerId, result.customerMatch], ["C-1001", "sender address jane.ortiz@northwind.example"]);
  check("status", [result.status, result.issues], ["READY", ""]);
  check("CSV starts with a UTF-8 BOM and the template's own header row",
    result.csv.split("\r\n")[0], "\ufeff" + TEMPLATE_HEADERS.join(","));
  const row = (line: string, item: string, price: string, memo: string) => ({
    TRANSACTIONTYPE: "Sales Order", DATE: "10/16/2026", GLPOSTINGDATE: "10/16/2026", CUSTOMER_ID: "C-1001", DATEDUE: "10/30/2026",
    DEPARTMENTID: "", LOCATIONID: "", LINE: line, ITEMID: item, PRICE: price, REFERENCENO: "45-10872", STATE: "Draft", CLASSID: "", MEMO: memo });
  check("CSV rows: Amount column becomes PRICE, accounting negative kept, Total row ignored", csvRecords(result.csv), [
    row("1", "INST-100", "1250", "Installation - Building A"),
    row("2", "MAINT-200", "480", "Quarterly maintenance, Q4"),
    row("3", "DISC-10", "-50", "Loyalty discount"),
  ]);
  check("every line is quantity 1", (result.summaryHtml.match(/text-align:right;">1</g) || []).length, 3);
  const grid = sheet.grid();
  check("sheet: header row kept, data starts on row 2, blank row reused", [grid[0], grid.length], [TEMPLATE_HEADERS, 4]);
  check("sheet: dates are real Excel dates", [grid[1][1], sheet.formats["1,1"], grid[1][4]], [serial("2026-10-16"), "mm/dd/yyyy", serial("2026-10-30")]);
  check("sheet: IDs stored as text", [sheet.formats["1,3"], sheet.formats["1,8"], sheet.formats["1,10"]], ["@", "@", "@"]);
  check("sheet: line and price are numbers", [grid[1][7], grid[1][9], grid[3][9]], [1, 1250, -50]);
  check("summary shows how the customer was matched", /sender address jane\.ortiz@northwind\.example/.test(result.summaryHtml), true);
  fs.writeFileSync(__dirname + "/sample-output.json", JSON.stringify({ name: sheet.name, rows: grid,
    formats: grid.map((row, r) => row.map((_, c) => sheet.formats[`${r},${c}`] || "")) }, null, 2));
  fs.writeFileSync(__dirname + "/sample-output.csv", result.csv);
}

console.log("Quantities");
{
  let r = run("PO #: 7001\nItem\tDescription\nINST-100\tInstallation\nTRAINING\tOn-site training", { sender: "east.buyer@contoso.example" }).result;
  check("item + description only (no amount): READY, due date = order date",
    [r.status, pick(csvRecords(r.csv), ["DATE", "DATEDUE", "ITEMID", "PRICE"])],
    ["READY", [["10/19/2026", "10/19/2026", "INST-100", ""], ["10/19/2026", "10/19/2026", "TRAINING", ""]]]);

  r = run("PO: 7002\nDescription\tAmount\nInstallation\t500.00\nTravel\t75.50", { sender: "east.buyer@contoso.example" }).result;
  check("description + amount, no item column: lines kept, ITEMID flagged",
    [r.status, pick(csvRecords(r.csv), ["ITEMID", "PRICE", "MEMO"]), r.issues.split("\n").length],
    ["REVIEW", [["", "500", "Installation"], ["", "75.5", "Travel"]], 2]);

  r = run("PO: 7003\nItem\tQty\tUnit Price\nINST-100\t3\t100.00", { sender: "east.buyer@contoso.example" }).result;
  check("an email that does show qty 3 is flagged (would bill 1 x unit price)",
    [r.status, r.issues], ["REVIEW", "Line 1 (INST-100) shows quantity 3 in the email, but lines import as quantity 1 - check the price."]);

  r = run("PO: 7004\nItem\tQty\tAmount\nINST-100\t1\t100.00", { sender: "east.buyer@contoso.example" }).result;
  check("an explicit qty of 1 is fine", r.status, "READY");

  const full = run("PO: 7005\nItem\tAmount\nINST-100\t100.00", { sender: "east.buyer@contoso.example",
    template: [["TRANSACTIONTYPE", "DATE", "CUSTOMER_ID", "LINE", "ITEMID", "QUANTITY", "PRICE"]] });
  check("if QUANTITY is ever added to the template it gets 1", pick(csvRecords(full.result.csv), ["ITEMID", "QUANTITY", "PRICE"]), [["INST-100", "1", "100"]]);
}

console.log("Customer lookup");
{
  const lookup = (body: string, sender: string, map?: string) => run(body + "\nPO: 1\nItem\tQty\nX-1\t1", { sender, map }).result;

  let r = lookup("Account #: 1100", "orders@bargainmart.example");
  check("code in the email (Account # = old account number in the map)", [r.customerId, r.customerMatch, r.status],
    ["C-1002", 'customer code "1100" in the email', "READY"]);

  r = lookup("Customer ID: c-2002", "x@unknown.example");
  check("Intacct ID in the email, any case -> exact ID", [r.customerId, r.status], ["C-2002", "READY"]);

  r = lookup("", "east.buyer@contoso.example");
  check("sender address beats a shared domain", [r.customerId, r.customerMatch], ["C-2001", "sender address east.buyer@contoso.example"]);

  r = lookup("", "new.person@contoso.example");
  check("shared domain alone is not enough", [r.customerId, r.status], ["", "REVIEW"]);
  check("ambiguity explained", /sender domain contoso\.example fits C-2001, C-2002/.test(r.issues), true);

  r = lookup("Sold To: Contoso Retail West", "new.person@contoso.example");
  check("shared domain + Sold To name decides", [r.customerId, r.customerMatch],
    ["C-2002", 'customer name "Contoso Retail West" in the email']);

  r = lookup("---------- Forwarded message ---------\nFrom: Jane Ortiz <jane.ortiz@northwind.example>\nSubject: Order", "cheney.smith@nphllc.com");
  check("forwarded email: original sender in the text", [r.customerId, r.customerMatch], ["C-1001", "an address in the email text"]);

  r = lookup("Bill To: Bargain Mart Inc.", "cheney.smith@nphllc.com");
  check("Bill To name, company suffix ignored", [r.customerId, r.status], ["C-1002", "READY"]);

  r = lookup("Please ship to our Northwind Traders warehouse.", "cheney.smith@nphllc.com");
  check("customer name anywhere in the text", [r.customerId, r.customerMatch], ["C-1001", "customer name found in the email text"]);

  r = lookup("Customer #: ZZ-999", "jane.ortiz@northwind.example");
  check("unknown ID in email but sender known -> use sender, flag it", [r.customerId, r.status], ["C-1001", "REVIEW"]);
  check("flag names both", /says customer "ZZ-999".*used C-1001/.test(r.issues), true);

  r = lookup("Customer #: ZZ-999", "x@unknown.example");
  check("unknown ID and nothing else -> keep ID, flag it", [r.customerId, r.status], ["ZZ-999", "REVIEW"]);

  r = lookup("Customer #: ZZ-999", "x@unknown.example", "");
  check("no map -> ID from the email as-is", [r.customerId, r.status], ["ZZ-999", "READY"]);

  r = lookup("", "x@unknown.example", "not json");
  check("unreadable map is flagged", /could not be read/.test(r.issues), true);
}

console.log("Template handling");
{
  // A template with an Intacct "#" comment row and leftover rows from someone's test.
  const template: Cell[][] = [
    TEMPLATE_HEADERS,
    ["# comment row Intacct skips"].concat(TEMPLATE_HEADERS.slice(1).map(() => "")),
    ["Sales Order", "old", "old", "OLD-CUST", "", "", "", 1, "OLD-ITEM", "", "", "", "", ""],
    ["Sales Order", "old", "old", "OLD-CUST", "", "", "", 2, "OLD-ITEM", "", "", "", "", ""],
    ["Sales Order", "old", "old", "OLD-CUST", "", "", "", 3, "OLD-ITEM", "", "", "", "", ""],
  ];
  const { sheet, result } = run("PO: 9\nItem\tQty\nX-1\t1", { sender: "east.buyer@contoso.example", template });
  const grid = sheet.grid();
  check("comment row kept, old rows replaced", grid.map((r) => r[8]), ["ITEMID", "", "X-1"]);
  check("CSV has header + data only", csvRecords(result.csv).length, 1);

  const empty = run("PO: 9\nItem\tQty\nX-1\t1", { sender: "east.buyer@contoso.example", template: [] });
  check("empty template gets NPH's columns", empty.sheet.grid()[0], TEMPLATE_HEADERS);
  check("empty template is not an issue", empty.result.status, "READY");

  // A fuller Intacct template: QUANTITY/UNIT present, a second CUSTOMER_ID column on the line.
  const full = ["TRANSACTIONTYPE", "DATE", "CUSTOMER_ID", "REFERENCENO", "MESSAGE", "LINE", "ITEMID", "QUANTITY", "UNIT", "CUSTOMER_ID", "CUSTOM_FIELD"];
  const f = run("PO: 9\nNotes: Leave at \"Dock 4\", gate B\nItem\tQty\tUOM\nX-1\t3\tea\nX-2\t2\tcs\nX-3\t4\t", { sender: "east.buyer@contoso.example", template: [full] });
  check("full template READY", [f.result.status, f.result.issues], ["READY", ""]);
  check("quantity, Intacct unit names, customer in both columns, unknown column blank",
    pick(csvRecords(f.result.csv), ["LINE", "ITEMID", "QUANTITY", "UNIT", "CUSTOM_FIELD"]),
    [["1", "X-1", "3", "Each"], ["2", "X-2", "2", "cs"], ["3", "X-3", "4", "Each"]].map((r) => r.concat([""])));
  check("both CUSTOMER_ID columns filled", f.sheet.grid()[1].filter((v) => v === "C-2001").length, 2);
  check("CSV quotes commas and quotes", f.result.csv.indexOf('"Leave at ""Dock 4"", gate B"') > 0, true);

  const missing = run("PO: 9\nItem\tQty\nX-1\t1", { sender: "east.buyer@contoso.example", template: [["TRANSACTIONTYPE", "DATE", "ITEMID"]] });
  check("missing CUSTOMER_ID column flagged", /no CUSTOMER_ID column/.test(missing.result.issues), true);
}

console.log("Email formats");
{
  const text = fs.readFileSync(__dirname + "/../../samples/order-email.txt", "utf8");
  let r = run(text, { subject: "New order", sender: "buyer@bargainmart.example" }).result;
  check("plain text: customer, PO, need-by date", [r.customerId, r.poNumber, csvRecords(r.csv)[0].DATEDUE], ["C-1002", "77311", "11/04/2026"]);
  check("plain text: READY", [r.status, r.issues], ["READY", ""]);
  check("plain text: lines", pick(csvRecords(r.csv), ["LINE", "ITEMID", "PRICE", "MEMO"]),
    [["1", "INST-100", "1250", "Installation - Building B"], ["2", "TRAVEL", "312.4", "Travel and lodging"]]);

  const nbsp =
    '<div><p class=MsoNormal>PO #: 77311<o:p></o:p></p>\n' +
    '<p class=MsoNormal>Item<span style="mso-spacerun:yes">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span>Qty&nbsp;&nbsp;&nbsp; UOM<o:p></o:p></p>\n' +
    '<p class=MsoNormal>LMP-103-BLK&nbsp;&nbsp; 1&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; EA<o:p></o:p></p>\n' +
    '<p class=MsoNormal>CAB-450&nbsp;&nbsp; 1&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; EA<o:p></o:p></p></div>';
  r = run(nbsp, { sender: "east.buyer@contoso.example" }).result;
  check("space-aligned table typed into Outlook (&nbsp; runs)", [r.status, pick(csvRecords(r.csv), ["ITEMID"])], ["READY", [["LMP-103-BLK"], ["CAB-450"]]]);

  const pipe = "| SKU | Qty | Price |\n|-----|-----|-------|\n| lmp-103-blk | 1 | 45.00 |\n| CAB-450 | 1 | 189.99 |\n\nSubtotal 234.99";
  r = run(pipe, { subject: "RE: PO# 99812 order", sender: "east.buyer@contoso.example" }).result;
  check("pipe table, PO from subject, item ID case kept", [r.status, r.poNumber, pick(csvRecords(r.csv), ["ITEMID"])],
    ["READY", "99812", [["lmp-103-blk"], ["CAB-450"]]]);

  r = run("<p>PO: 5501</p><p>Item: INST-100 Amount: $1,250.00</p><p>Item: TRAVEL</p>", { sender: "east.buyer@contoso.example" }).result;
  check("one item per line (no table), amount optional", [r.status, pick(csvRecords(r.csv), ["LINE", "ITEMID", "PRICE"])],
    ["READY", [["1", "INST-100", "1250"], ["2", "TRAVEL", ""]]]);

  const unreadable = run("<p>Hi, please see the attached PO. Thanks!</p>", { subject: "Order attached" });
  check("unreadable email -> REVIEW with 3 issues", [unreadable.result.status, unreadable.result.issues.split("\n").length], ["REVIEW", 3]);
  check("unreadable email still gets one header row to fill in", pick(csvRecords(unreadable.result.csv), ["TRANSACTIONTYPE", "LINE", "ITEMID"]),
    [["Sales Order", "1", ""]]);

  r = run("PO: 1\nOrder Date: someday\nItem\tQty\nX-1\tfive\nX-2\t1", { sender: "east.buyer@contoso.example" }).result;
  check("bad date + bad qty flagged, good line kept", [r.status, /someday/.test(r.issues), /skipped/.test(r.issues), pick(csvRecords(r.csv), ["DATE", "ITEMID"])],
    ["REVIEW", true, true, [["10/19/2026", "X-2"]]]);
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
check("format for Intacct", formatDate("2026-11-04", "MM/DD/YYYY"), "11/04/2026");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
