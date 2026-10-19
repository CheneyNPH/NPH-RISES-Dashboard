/**
 * Build Sage OE Import - Office Script (Excel for the web > Automate)
 *
 * Power Automate calls this with the Excel Online (Business) "Run script" action,
 * pointed at a fresh copy of your Sage Intacct Order Entry transaction import template
 * (downloaded from Intacct and saved as .xlsx). It reads one order email (HTML or
 * plain text), looks up the Intacct customer ID in your customer map, writes one row
 * per order line under the template's header row, and returns the same rows as CSV
 * (Intacct's CSV import takes .csv files) plus a summary for the notification email.
 *
 * Anything the script is unsure about is listed in `issues` and the status becomes
 * "REVIEW" instead of "READY", so a person checks the file before importing it.
 *
 * To match your Intacct setup or your order emails, edit getConfig() only.
 */

interface ImportResult {
  status: string;        // "READY" or "REVIEW"
  customerId: string;
  customerMatch: string; // how the customer was identified, e.g. "sender address buyer@acme.com"
  poNumber: string;
  orderDate: string;     // yyyy-mm-dd
  lineCount: number;
  issues: string;        // one issue per line; empty when status is READY
  csv: string;           // the import rows as CSV, ready for Intacct's CSV import
  summaryHtml: string;   // HTML block for the notification email body
}

interface Config {
  transactionType: string;        // TRANSACTIONTYPE: your Order Entry transaction definition name
  state: string;                  // STATE: "Draft" to review in Intacct before submitting, or "Pending"
  documentNumberFromPo: boolean;  // false = leave DOCUMENTNO blank for Intacct auto-numbering
  headerOnFirstLineOnly: boolean; // false = repeat header values (date, customer...) on every line row
  dueDateSource: string;          // DATEDUE: "requested" (email's ship/need-by date, else order date), "order" or "blank"
  defaultUnit: string;            // UNIT is required; used when the email gives no unit
  unitNames: UnitName[];          // unit written in emails -> Intacct unit name
  includePrices: boolean;         // false = Intacct prices the lines from the price list
  requirePoNumber: boolean;
  uppercaseItems: boolean;        // Intacct IDs are case-sensitive, so only if all your item IDs are upper case
  dateFormat: string;             // must match the date format picked on Intacct's import screen
  fixedValues: ColumnValue[];     // same value on every row, e.g. LOCATIONID or DEPARTMENTID
  columns: ColumnTarget[];        // which template columns receive which value
  requiredColumns: string[];      // flagged if the import template is missing one
  customerMap: CustomerEntry[];   // optional; the flow normally passes Customer_Map.xlsx instead
  headerFields: FieldLabels[];
  lineColumns: FieldLabels[];
  maxLengths: FieldLength[];
}

interface UnitName { from: string; to: string; }
interface ColumnValue { column: string; value: string; }
interface ColumnTarget { field: string; columns: string[]; }
interface FieldLabels { field: string; labels: RegExp[]; }
interface FieldLength { field: string; max: number; }

interface CustomerEntry {
  id: string;        // Intacct customer ID, exactly as in Intacct
  name: string;      // customer name as it appears in their emails
  emails: string[];  // sender addresses that belong to this customer
  domains: string[]; // e.g. "acme.com" - leave out shared domains such as gmail.com
  aliases: string[]; // other names or codes this customer uses in emails (old account #, DBA name...)
}

interface MapRow { [column: string]: string | number | boolean | null; }

interface OrderLine {
  item: string;
  description: string;
  qty: number;
  unit: string;
  price: number;
  hasPrice: boolean;
}

interface ParsedOrder {
  customerId: string;
  customerMatch: string;
  poNumber: string;
  orderDate: string; // yyyy-mm-dd
  expDate: string;   // yyyy-mm-dd or ""
  comment: string;
  lines: OrderLine[];
  issues: string[];
}

function getConfig(): Config {
  return {
    transactionType: "Sales Order",
    state: "Draft",
    documentNumberFromPo: false,
    headerOnFirstLineOnly: false,
    dueDateSource: "requested",
    defaultUnit: "Each",
    unitNames: [{ from: "EA", to: "Each" }, { from: "EACH", to: "Each" }],
    includePrices: true,
    requirePoNumber: true,
    uppercaseItems: false,
    dateFormat: "MM/DD/YYYY",

    // Dimension values to put on every row - fill in your IDs, or leave "" for blank.
    // Add { column: "WAREHOUSEID", value: "..." } if you add WAREHOUSEID to the template.
    fixedValues: [
      { column: "LOCATIONID", value: "" },
      { column: "DEPARTMENTID", value: "" },
      { column: "CLASSID", value: "" },
    ],

    // Value -> template column(s). Columns missing from your template are skipped.
    columns: [
      { field: "transactionType", columns: ["TRANSACTIONTYPE"] },
      { field: "date", columns: ["DATE"] },
      { field: "glPostingDate", columns: ["GLPOSTINGDATE"] },
      { field: "documentNo", columns: ["DOCUMENTNO"] },
      { field: "poNumber", columns: ["REFERENCENO"] },
      { field: "customerId", columns: ["CUSTOMER_ID"] },
      { field: "dueDate", columns: ["DATEDUE"] },
      { field: "message", columns: ["MESSAGE"] },
      { field: "state", columns: ["STATE"] },
      { field: "requestedDate", columns: [] },
      { field: "line", columns: ["LINE"] },
      { field: "lineCustomerId", columns: ["CUSTOMERID"] },
      { field: "itemId", columns: ["ITEMID", "ITEM_ID"] },
      { field: "itemDescription", columns: ["MEMO"] },
      { field: "quantity", columns: ["QUANTITY"] },
      { field: "unit", columns: ["UNIT"] },
      { field: "price", columns: ["PRICE"] },
    ],
    requiredColumns: ["TRANSACTIONTYPE", "DATE", "CUSTOMER_ID", "ITEMID"],

    // Paste entries here only if you'd rather not keep Customer_Map.xlsx, e.g.
    // { id: "C-1001", name: "Acme Corporation", emails: ["buyer@acme.com"], domains: ["acme.com"], aliases: ["ACME"] }
    customerMap: [],

    // "Label: value" lines in the email body. Each regex matches the label only;
    // the script adds the ":" / "#" / table-cell separator itself.
    headerFields: [
      { field: "CUSTOMER", labels: [
        /cust(?:omer)?\.?\s*(?:number|num|no\.?|#|id|code|acct|account)/,
        /(?:account|acct)\.?\s*(?:number|num|no\.?|#)?/,
        /bill[\s-]*to\s*(?:number|no\.?|#|code|id)/,
      ] },
      { field: "CUSTOMERNAME", labels: [
        /customer(?!\s*(?:#|no\b|num|id\b|code|acct|account|p\.?\s?o\b))(?:\s*name)?/,
        /company(?:\s*name)?/,
        /sold[\s-]*to(?:\s*name)?/,
        /bill[\s-]*to(?!\s*(?:#|no\b|num|id\b|code))(?:\s*name)?/,
      ] },
      { field: "PONUMBER", labels: [
        /(?:customer\s+)?p\.?\s?o\.?(?:\s*(?:#|no\.?|num(?:ber)?))?/,
        /purchase\s+order(?:\s*(?:#|no\.?|num(?:ber)?))?/,
      ] },
      { field: "ORDDATE", labels: [
        /order\s*date/, /p\.?\s?o\.?\s*date/, /date\s*ordered/,
      ] },
      { field: "EXPDATE", labels: [
        /(?:requested|required|expected)?\s*(?:ship|delivery)\s*date/,
        /(?:required|requested|due)\s*date/, /need(?:ed)?\s*by(?:\s*date)?/, /ship\s*by/,
      ] },
      { field: "COMMENT", labels: [
        /comments?/, /notes?/, /special\s+instructions/, /instructions/,
      ] },
    ],

    // Line-item table headers. Checked top to bottom; each table column is claimed
    // by the first field that matches it, so IGNORE keeps totals and line numbers out.
    lineColumns: [
      { field: "IGNORE", labels: [/ext|total|amount|amt|^line\s*(?:#|no\.?)?$|^ln$|^#$/] },
      { field: "DESC", labels: [/desc|name/] },
      { field: "PRICE", labels: [/price|cost|^each$|^rate$/] },
      { field: "QTY", labels: [/qty|quantity|qnty|^order(?:ed)?\s*q/] },
      { field: "UNIT", labels: [/^u\/?m$|uom|unit\s*of\s*measure|^units?$|^pack$/] },
      { field: "ITEM", labels: [/item|sku|part|product|style|model|^code$/] },
    ],

    // Intacct field lengths; longer values are cut and flagged for review.
    maxLengths: [{ field: "CUSTOMER_ID", max: 20 }, { field: "DOCUMENTNO", max: 45 }],
  };
}

function main(
  workbook: ExcelScript.Workbook,
  emailBody: string,
  subject: string,
  sender: string,
  receivedDate: string,
  customerMapJson?: string
): ImportResult {
  const config = getConfig();
  const issues: string[] = [];
  const customers = config.customerMap.concat(parseCustomerMap(customerMapJson || "", issues));
  const order = parseOrder(config, customers, emailBody || "", subject || "", sender || "", receivedDate || "", issues);
  const rows = writeImport(workbook, config, order);

  return {
    status: order.issues.length === 0 ? "READY" : "REVIEW",
    customerId: order.customerId,
    customerMatch: order.customerMatch,
    poNumber: order.poNumber,
    orderDate: order.orderDate,
    lineCount: order.lines.length,
    issues: order.issues.join("\n"),
    csv: "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n", // UTF-8 BOM, as Excel's "CSV UTF-8"
    summaryHtml: buildSummaryHtml(config, order, subject || "", sender || ""),
  };
}

// ----------------------------- Parsing -----------------------------

function parseOrder(
  config: Config,
  customers: CustomerEntry[],
  body: string,
  subject: string,
  sender: string,
  receivedDate: string,
  issues: string[]
): ParsedOrder {
  const text = toPlainText(body);

  const customer = resolveCustomer(customers, findHeaderValue(config, text, "CUSTOMER"),
    findHeaderValue(config, text, "CUSTOMERNAME"), sender, text, issues);

  let poNumber = findHeaderValue(config, text, "PONUMBER");
  if (!poNumber) {
    const subjectPo = /\bP\.?\s?O\.?\s*(?:#|no\.?|num(?:ber)?)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i.exec(subject);
    if (subjectPo && /\d/.test(subjectPo[1])) {
      poNumber = subjectPo[1];
    }
  }
  if (!poNumber && config.requirePoNumber) {
    issues.push("PO number not found in the email or subject.");
  }

  let orderDate = "";
  const orderDateText = findHeaderValue(config, text, "ORDDATE");
  if (orderDateText) {
    orderDate = parseDate(orderDateText);
    if (!orderDate) {
      issues.push(`Order date "${orderDateText}" not recognized - used the received date instead.`);
    }
  }
  if (!orderDate) {
    orderDate = parseDate(receivedDate) || todayIso();
  }

  let expDate = "";
  const expDateText = findHeaderValue(config, text, "EXPDATE");
  if (expDateText) {
    expDate = parseDate(expDateText);
    if (!expDate) {
      issues.push(`Ship/required date "${expDateText}" not recognized.`);
    }
  }

  const lines = findLines(config, text, issues);
  if (lines.length === 0) {
    issues.push("No line items found in the email body - add them to the import file.");
  }

  return {
    customerId: limit(config, "CUSTOMER_ID", customer.id, issues),
    customerMatch: customer.how,
    poNumber: poNumber,
    orderDate: orderDate,
    expDate: expDate,
    comment: findHeaderValue(config, text, "COMMENT"),
    lines: lines,
    issues: issues,
  };
}

/** Converts an HTML (or plain text) email body to text: table cells become tabs, rows/paragraphs become lines. */
function toPlainText(body: string): string {
  let s = body;
  const isHtml = /<\s*(html|body|div|p|br|table|span|td)\b/i.test(s);
  if (isHtml) {
    // Source whitespace means nothing in HTML; &nbsp; runs (aligned columns) are kept.
    s = s.replace(/[ \t\r\n]+/g, " ");
    s = s.replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, " ");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    s = s.replace(/<\/(?:p|div)\s*>\s*(?=<\/t[dh]\s*>)/gi, ""); // Outlook wraps each cell in <p>
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n");
    s = s.replace(/<\/t[dh]\s*>/gi, "\t");
    s = s.replace(/<[^>]+>/g, "");
  }
  s = decodeEntities(s).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  return s
    .split("\n")
    .map((line) => {
      const trimmed = line.replace(/ *\t */g, "\t").replace(/^ +| +$/g, "");
      return isHtml ? trimmed.replace(/\t$/, "") : trimmed; // drop the tab left by a row's last </td>
    })
    .join("\n");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&#(\d+);/g, (m: string, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (m: string, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, "&");
}

/** Finds "Label: value" (same line, or value on the next line) for a configured header field. */
function findHeaderValue(config: Config, text: string, field: string): string {
  let labels: RegExp[] = [];
  for (const f of config.headerFields) {
    if (f.field === field) {
      labels = f.labels;
    }
  }
  if (labels.length === 0) {
    return "";
  }
  const label = "(?:" + labels.map((r) => r.source).join("|") + ")";

  const sameLine = new RegExp("^[ \\t]*" + label + "[ \\t]*(?:[:#]|\\t)[ \\t]*([^\\t\\n]+)", "im").exec(text);
  if (sameLine) {
    return cleanValue(sameLine[1]);
  }
  const nextLine = new RegExp("^[ \\t]*" + label + "[ \\t]*:[ \\t]*\\n[ \\t]*([^\\t\\n]+)", "im").exec(text);
  if (nextLine && !/^[^:]{1,40}:/.test(nextLine[1])) {
    return cleanValue(nextLine[1]);
  }
  return "";
}

/** Trims a value and cuts off a second "Label:" that shares the same line. */
function cleanValue(value: string): string {
  return value.split(/\s{2,}(?=[A-Za-z][A-Za-z .#\/-]{0,30}:)/)[0].trim();
}

/** Finds the line-item table (a header row with item + qty columns) and reads the rows under it. */
function findLines(config: Config, text: string, issues: string[]): OrderLine[] {
  const textLines = text.split("\n");

  for (let i = 0; i < textLines.length; i++) {
    const delimiter = detectDelimiter(textLines[i]);
    if (!delimiter) {
      continue;
    }
    const headerCells = splitCells(textLines[i], delimiter);
    const columns = mapColumns(config, headerCells);
    if (columns.item < 0 || columns.qty < 0) {
      continue;
    }

    const lines: OrderLine[] = [];
    for (let j = i + 1; j < textLines.length; j++) {
      const raw = textLines[j];
      if (!raw.trim()) {
        if (lines.length > 0) {
          break;
        }
        continue;
      }
      if (/^(?:sub[\s-]*)?total|^(?:sales\s+)?tax\b|^shipping|^freight|^grand/i.test(raw.replace(/^\t+/, ""))) {
        break;
      }
      const cells = splitCells(raw, delimiter);
      if (cells.length < 2) {
        break;
      }
      if (cells.every((c) => /^[-=:_\s]*$/.test(c))) {
        continue; // "|----|----|" separator under a text table header
      }
      const rowLabel = `Row ${lines.length + 1} ("${raw.replace(/\t/g, " | ")}")`;
      if (cells.length !== headerCells.length) {
        issues.push(`${rowLabel} has ${cells.length} columns but the table header has ${headerCells.length} - check item/qty/price.`);
      }

      const item = cell(cells, columns.item);
      const qtyText = cell(cells, columns.qty);
      if (!item && !qtyText) {
        continue;
      }
      const qty = parseNumber(qtyText);
      if (!item || isNaN(qty) || qty <= 0) {
        issues.push(`${rowLabel} skipped - missing item number or quantity.`);
        continue;
      }

      let unit = cell(cells, columns.unit);
      const qtyUnit = /^[\d,.]+\s*([A-Za-z]{1,10})$/.exec(qtyText);
      if (!unit && qtyUnit) {
        unit = qtyUnit[1];
      }
      const price = parseNumber(cell(cells, columns.price));
      lines.push({
        item: item,
        description: cell(cells, columns.desc),
        qty: qty,
        unit: unit,
        price: isNaN(price) ? 0 : price,
        hasPrice: !isNaN(price),
      });
    }
    if (lines.length > 0) {
      return normalizeLines(config, lines);
    }
  }

  // Fallback: one line item per line, e.g. "Item: A1-103/0  Qty: 5"
  const lines: OrderLine[] = [];
  const inline = /(?:item|sku|part)\s*(?:#|no\.?|number)?\s*[:#]\s*([A-Za-z0-9][\w\-\/.]*)[\s\S]*?(?:qty|quantity)\s*[:=x]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]{1,10})?/i;
  for (const raw of textLines) {
    const m = inline.exec(raw);
    if (m) {
      lines.push({ item: m[1], description: "", qty: parseNumber(m[2]), unit: m[3] || "", price: 0, hasPrice: false });
    }
  }
  return normalizeLines(config, lines);
}

interface ColumnMap { item: number; desc: number; qty: number; unit: number; price: number; }

function mapColumns(config: Config, headerCells: string[]): ColumnMap {
  const claimed: boolean[] = headerCells.map(() => false);
  const result: ColumnMap = { item: -1, desc: -1, qty: -1, unit: -1, price: -1 };
  for (const col of config.lineColumns) {
    for (let c = 0; c < headerCells.length; c++) {
      const name = headerCells[c].toLowerCase().replace(/[:.]+$/, "").trim();
      if (claimed[c] || !name || !col.labels.some((r) => r.test(name))) {
        continue;
      }
      claimed[c] = true;
      if (col.field === "ITEM") { result.item = c; }
      if (col.field === "DESC") { result.desc = c; }
      if (col.field === "QTY") { result.qty = c; }
      if (col.field === "UNIT") { result.unit = c; }
      if (col.field === "PRICE") { result.price = c; }
      if (col.field !== "IGNORE") {
        break;
      }
    }
  }
  return result;
}

function detectDelimiter(line: string): string {
  if (line.indexOf("\t") >= 0) { return "\t"; }
  if (line.indexOf("|") >= 0) { return "|"; }
  if (/\S {2,}\S/.test(line)) { return "  "; }
  if (line.indexOf(",") >= 0) { return ","; }
  return "";
}

function splitCells(line: string, delimiter: string): string[] {
  let s = delimiter === "\t" ? line.replace(/^ +| +$/g, "") : line.trim(); // keep empty leading cells
  if (delimiter === "|") {
    s = s.replace(/^\|/, "").replace(/\|$/, "");
  }
  const parts = delimiter === "  " ? s.split(/ {2,}/) : s.split(delimiter);
  return parts.map((p) => p.trim());
}

function cell(cells: string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : "";
}

/** Applies item-ID casing and turns email units ("EA", none) into Intacct unit names. */
function normalizeLines(config: Config, lines: OrderLine[]): OrderLine[] {
  for (const line of lines) {
    line.item = config.uppercaseItems ? line.item.trim().toUpperCase() : line.item.trim();
    let unit = line.unit.trim() || config.defaultUnit;
    for (const u of config.unitNames) {
      if (unit.toLowerCase() === u.from.toLowerCase()) {
        unit = u.to;
      }
    }
    line.unit = unit;
  }
  return lines;
}

function parseNumber(value: string): number {
  const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec((value || "").replace(/[$\s]/g, ""));
  return m ? parseFloat(m[0].replace(/,/g, "")) : NaN;
}

/** Returns yyyy-mm-dd, or "" if the text has no recognizable date. Numeric dates are read as US m/d/y. */
function parseDate(value: string): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const s = (value || "").trim();
  let y = 0;
  let m = 0;
  let d = 0;
  let match = /\b(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) {
    y = +match[1]; m = +match[2]; d = +match[3];
  } else if ((match = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(s))) {
    m = +match[1]; d = +match[2]; y = +match[3];
  } else if ((match = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s))) {
    m = months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1; d = +match[2]; y = +match[3];
  } else if ((match = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{2,4})\b/.exec(s))) {
    d = +match[1]; m = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1; y = +match[3];
  } else {
    return "";
  }
  if (y < 100) {
    y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Excel date serial for a yyyy-mm-dd string. */
function excelDate(iso: string): number {
  const p = iso.split("-");
  return (Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Formats yyyy-mm-dd with a pattern such as MM/DD/YYYY, DD/MM/YYYY or YYYY-MM-DD. */
function formatDate(iso: string, pattern: string): string {
  const p = iso.split("-");
  return pattern.replace("YYYY", p[0]).replace("MM", p[1]).replace("DD", p[2]);
}

function limit(config: Config, field: string, value: string, issues: string[]): string {
  for (const f of config.maxLengths) {
    if (f.field === field && value.length > f.max) {
      issues.push(`${field} "${value}" is longer than Intacct allows (${f.max}) - cut to "${value.slice(0, f.max)}".`);
      return value.slice(0, f.max);
    }
  }
  return value;
}

function endsWith(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
}

// ----------------------------- Customer map -----------------------------

/**
 * Reads the customer map rows the flow passes in ("List rows present in a table" on
 * Customer_Map.xlsx). Columns are recognized by name: Customer ID, Customer Name,
 * Sender Emails, Sender Domains, Other Names or Codes. Cells may hold several values
 * separated by ";" (or new lines).
 */
function parseCustomerMap(json: string, issues: string[]): CustomerEntry[] {
  if (!json.trim()) {
    return [];
  }
  let rows: MapRow[] = [];
  try {
    rows = JSON.parse(json) as MapRow[];
  } catch (error) {
    issues.push("The customer map passed by the flow could not be read - customer was not looked up.");
    return [];
  }
  if (!Array.isArray(rows)) {
    issues.push("The customer map passed by the flow is not a list of rows - customer was not looked up.");
    return [];
  }

  const entries: CustomerEntry[] = [];
  for (const row of rows) {
    const entry: CustomerEntry = { id: "", name: "", emails: [], domains: [], aliases: [] };
    for (const key of Object.keys(row)) {
      const k = key.toLowerCase().replace(/[^a-z]/g, "");
      const raw = row[key];
      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!value || k.indexOf("odata") >= 0 || k === "iteminternalid") {
        continue;
      }
      if (k.indexOf("customerid") >= 0 || k === "id" || k === "intacctid") {
        entry.id = value;
      } else if (k.indexOf("mail") >= 0) {
        entry.emails = entry.emails.concat(splitList(value, /[;,\s]+/).map((v) => v.toLowerCase()));
      } else if (k.indexOf("domain") >= 0) {
        entry.domains = entry.domains.concat(splitList(value, /[;,\s]+/).map((v) => v.toLowerCase().replace(/^@/, "")));
      } else if (/other|alias|code|aka|account|ref/.test(k)) {
        entry.aliases = entry.aliases.concat(splitList(value, /[;\n]+/));
      } else if (k.indexOf("name") >= 0) {
        entry.name = value;
      }
    }
    if (entry.id) {
      entries.push(entry);
    }
  }
  if (rows.length > 0 && entries.length === 0) {
    issues.push('The customer map has no "Customer ID" column - customer was not looked up.');
  }
  return entries;
}

function splitList(value: string, separator: RegExp): string[] {
  return value.split(separator).map((v) => v.trim()).filter((v) => v !== "");
}

interface CustomerMatch { id: string; how: string; }

/**
 * Finds the Intacct customer ID. In order: an ID or code written in the email, the
 * sender's address, addresses quoted in the body (forwarded emails), the sender's
 * domain, a "Customer:" / "Bill To:" name, then a customer name found in the text.
 * A step only decides when it points at exactly one customer.
 */
function resolveCustomer(customers: CustomerEntry[], idText: string, nameText: string, sender: string, text: string, issues: string[]): CustomerMatch {
  if (customers.length === 0) {
    if (idText) {
      return { id: idText, how: "customer ID in the email (no customer map)" };
    }
    issues.push("Customer ID not found in the email, and no customer map was provided.");
    return { id: "", how: "" };
  }

  const ambiguous: string[] = [];
  let unknownId = "";
  if (idText) {
    const byId = customers.filter((c) => c.id.toLowerCase() === idText.toLowerCase());
    if (byId.length > 0) {
      return { id: byId[0].id, how: `customer ID "${idText}" in the email` };
    }
    const byCode = distinct(customers.filter((c) => c.aliases.some((a) => normName(a) === normName(idText))));
    if (byCode.length === 1) {
      return { id: byCode[0].id, how: `customer code "${idText}" in the email` };
    }
    if (byCode.length > 1) {
      ambiguous.push(`customer code "${idText}" fits ${byCode.map((c) => c.id).join(", ")}`);
    } else {
      unknownId = idText;
    }
  }

  const senderEmail = firstEmail(sender);
  const senderDomain = domainOf(senderEmail);
  const bodyEmails = allEmails(text).filter((e) => e !== senderEmail);
  const nameWords = normName(nameText);
  const textWords = normName(text);
  const steps: { how: string; find: () => CustomerEntry[] }[] = [
    { how: `sender address ${senderEmail}`,
      find: () => customers.filter((c) => senderEmail !== "" && c.emails.indexOf(senderEmail) >= 0) },
    { how: "an address in the email text",
      find: () => customers.filter((c) => bodyEmails.some((e) => c.emails.indexOf(e) >= 0)) },
    { how: `sender domain ${senderDomain}`,
      find: () => customers.filter((c) => c.domains.some((d) => domainMatches(senderDomain, d))) },
    { how: "an email domain in the email text",
      find: () => customers.filter((c) => bodyEmails.some((e) => c.domains.some((d) => domainMatches(domainOf(e), d)))) },
    { how: `customer name "${nameText}" in the email`,
      find: () => customers.filter((c) => nameWords !== "" && namesOf(c).some((n) => containsWords(nameWords, n))) },
    { how: "customer name found in the email text",
      find: () => customers.filter((c) => namesOf(c).some((n) => n.length >= 4 && containsWords(textWords, n))) },
  ];

  for (const step of steps) {
    const found = distinct(step.find());
    if (found.length === 1) {
      if (unknownId) {
        issues.push(`The email says customer "${unknownId}", which is not in the customer map - used ${found[0].id} (matched by ${step.how}). Confirm the customer.`);
      }
      return { id: found[0].id, how: step.how };
    }
    if (found.length > 1) {
      ambiguous.push(`${step.how} fits ${found.map((c) => c.id).join(", ")}`);
    }
  }

  if (unknownId) {
    issues.push(`The email says customer "${unknownId}", which is not in the customer map - check the ID or add it to the map.`);
    return { id: unknownId, how: "customer ID in the email (not in the customer map)" };
  }
  issues.push("Customer could not be identified from the customer map - enter CUSTOMER_ID in the import file" +
    (ambiguous.length > 0 ? ` (${ambiguous.join("; ")}).` : "."));
  return { id: "", how: "" };
}

function namesOf(c: CustomerEntry): string[] {
  return [c.name].concat(c.aliases).map(normName).filter((n) => n !== "");
}

/** Lower-cases, drops punctuation and trailing company suffixes: "Acme Corp., Inc." -> "acme". */
function normName(value: string): string {
  let words = value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  const suffixes = ["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "lp", "llp", "plc"];
  while (words.length > 1 && suffixes.indexOf(words[words.length - 1]) >= 0) {
    words = words.slice(0, words.length - 1);
  }
  if (words.length > 1 && words[0] === "the") {
    words = words.slice(1);
  }
  return words.join(" ");
}

function containsWords(haystack: string, needle: string): boolean {
  return needle !== "" && (" " + haystack + " ").indexOf(" " + needle + " ") >= 0;
}

function firstEmail(value: string): string {
  const all = allEmails(value);
  return all.length > 0 ? all[0] : "";
}

function allEmails(text: string): string[] {
  const found: string[] = [];
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  let m = re.exec(text);
  while (m) {
    const email = m[0].toLowerCase();
    if (found.indexOf(email) < 0) {
      found.push(email);
    }
    m = re.exec(text);
  }
  return found;
}

function domainOf(email: string): string {
  return email.indexOf("@") >= 0 ? email.slice(email.indexOf("@") + 1) : "";
}

function domainMatches(domain: string, mapped: string): boolean {
  return domain !== "" && mapped !== "" && (domain === mapped || endsWith(domain, "." + mapped));
}

function distinct(entries: CustomerEntry[]): CustomerEntry[] {
  const out: CustomerEntry[] = [];
  for (const e of entries) {
    if (!out.some((o) => o.id === e.id)) {
      out.push(e);
    }
  }
  return out;
}

// ----------------------------- Writing -----------------------------

type CellValue = string | number;

/**
 * Writes one row per order line under the template's header row (the row that holds
 * TRANSACTIONTYPE / CUSTOMER_ID / ITEMID) on the first sheet, and returns the header
 * plus data rows as text for the CSV file.
 */
function writeImport(workbook: ExcelScript.Workbook, config: Config, order: ParsedOrder): string[][] {
  // Used only if the template sheet is empty: the Order Entry import columns from your Intacct company.
  const defaultColumns = [
    "TRANSACTIONTYPE", "DATE", "GLPOSTINGDATE", "CUSTOMER_ID", "DATEDUE", "DEPARTMENTID", "LOCATIONID",
    "LINE", "ITEMID", "PRICE", "REFERENCENO", "STATE", "CLASSID", "MEMO",
  ];
  const headerFields = ["transactionType", "date", "glPostingDate", "documentNo", "poNumber", "customerId", "dueDate", "message", "state", "requestedDate"];
  const dateFields = ["date", "glPostingDate", "dueDate", "requestedDate"];
  const numberFields = ["line", "quantity", "price"];

  const sheet = workbook.getWorksheets()[0];
  const used = sheet.getUsedRange(true);
  const grid: CellValue[][] = used ? used.getValues().map((r) => r.map((v) => (typeof v === "boolean" ? String(v) : v))) : [];
  const top = used ? used.getRowIndex() : 0;
  const left = used ? used.getColumnIndex() : 0;

  let headerRow = -1;
  for (let r = 0; r < grid.length && headerRow < 0; r++) {
    if (grid[r].some((v) => ["TRANSACTIONTYPE", "CUSTOMER_ID", "ITEMID"].indexOf(String(v).trim().toUpperCase()) >= 0)) {
      headerRow = r;
    }
  }

  let headers: string[];
  let headerAbsRow: number;
  let headerAbsCol: number;
  if (headerRow >= 0) {
    headers = grid[headerRow].map((v) => String(v).trim());
    while (headers.length > 0 && headers[headers.length - 1] === "") {
      headers.pop();
    }
    headerAbsRow = top + headerRow;
    headerAbsCol = left;
  } else {
    if (grid.some((r) => r.some((v) => String(v).trim() !== ""))) {
      order.issues.push("The template's header row (TRANSACTIONTYPE, CUSTOMER_ID, ITEMID...) was not found - used the default Intacct columns.");
    }
    sheet.getRange().clear();
    headers = defaultColumns.slice();
    headerAbsRow = 0;
    headerAbsCol = 0;
    sheet.getRangeByIndexes(0, 0, 1, headers.length).setValues([headers]);
  }

  // Keep "#" comment rows (Intacct skips them) right under the header; clear anything below.
  let dataRow = headerAbsRow + 1;
  while (headerRow >= 0 && dataRow - top < grid.length && String(grid[dataRow - top][0]).trim().indexOf("#") === 0) {
    dataRow++;
  }
  const lastRow = top + grid.length - 1;
  if (headerRow >= 0 && lastRow >= dataRow) {
    sheet.getRangeByIndexes(dataRow, headerAbsCol, lastRow - dataRow + 1, Math.max(headers.length, grid[0].length)).clear();
  }

  const upper = headers.map((h) => h.toUpperCase());
  for (const required of config.requiredColumns) {
    if (upper.indexOf(required.toUpperCase()) < 0) {
      order.issues.push(`The import template has no ${required} column - check that it is Intacct's Order Entry transactions template.`);
    }
  }

  // Column index -> which field fills it.
  const fieldOf: string[] = headers.map(() => "");
  for (const target of config.columns) {
    for (const column of target.columns) {
      upper.forEach((h, i) => { if (h === column.toUpperCase()) { fieldOf[i] = target.field; } });
    }
  }

  // Without a QUANTITY column every line imports as one unit, so flag lines for more than one.
  if (fieldOf.indexOf("quantity") < 0) {
    order.lines.forEach((l, i) => {
      if (l.qty !== 1) {
        order.issues.push(`Line ${i + 1} (${l.item}) is for ${l.qty}, but the import template has no QUANTITY column - set the quantity in Intacct after importing.`);
      }
    });
  }

  const lines: (OrderLine | null)[] = order.lines.length > 0 ? order.lines : [null];
  const values: CellValue[][] = lines.map((line, i) => headers.map((h, c) => {
    const fixed = config.fixedValues.filter((f) => f.column.toUpperCase() === upper[c]);
    if (fixed.length > 0) {
      return fixed[0].value;
    }
    const field = fieldOf[c];
    if (!field || (i > 0 && config.headerOnFirstLineOnly && headerFields.indexOf(field) >= 0)) {
      return "";
    }
    return fieldValue(config, order, field, line, i);
  }));

  if (values.length > 0 && headers.length > 0) {
    for (let c = 0; c < headers.length; c++) {
      const format = dateFields.indexOf(fieldOf[c]) >= 0 ? "mm/dd/yyyy" : numberFields.indexOf(fieldOf[c]) >= 0 ? "General" : "@";
      sheet.getRangeByIndexes(dataRow, headerAbsCol + c, values.length, 1).setNumberFormatLocal(format);
    }
    sheet.getRangeByIndexes(dataRow, headerAbsCol, values.length, headers.length).setValues(values);
    sheet.getRangeByIndexes(headerAbsRow, headerAbsCol, 1, headers.length).getFormat().getFont().setBold(true);
    sheet.getRangeByIndexes(headerAbsRow, headerAbsCol, values.length + 1, headers.length).getFormat().autofitColumns();
  }

  const csvRows: string[][] = [headers];
  for (const row of values) {
    csvRows.push(row.map((v, c) =>
      dateFields.indexOf(fieldOf[c]) >= 0 && typeof v === "number" ? formatDate(isoFromExcel(v), config.dateFormat) : String(v)));
  }
  return csvRows;
}

function fieldValue(config: Config, order: ParsedOrder, field: string, line: OrderLine | null, index: number): CellValue {
  switch (field) {
    case "transactionType": return config.transactionType;
    case "date": return excelDate(order.orderDate);
    case "glPostingDate": return excelDate(order.orderDate);
    case "documentNo": return config.documentNumberFromPo ? limit(config, "DOCUMENTNO", order.poNumber, index === 0 ? order.issues : []) : "";
    case "poNumber": return order.poNumber;
    case "customerId": return order.customerId;
    case "lineCustomerId": return order.customerId;
    case "dueDate": return config.dueDateSource === "blank" ? ""
      : excelDate(config.dueDateSource === "requested" && order.expDate ? order.expDate : order.orderDate);
    case "message": return order.comment;
    case "state": return config.state;
    case "requestedDate": return order.expDate ? excelDate(order.expDate) : "";
    case "line": return index + 1;
    case "itemId": return line ? line.item : "";
    case "itemDescription": return line ? line.description : "";
    case "quantity": return line ? line.qty : "";
    case "unit": return line ? line.unit : "";
    case "price": return line && config.includePrices && line.hasPrice ? line.price : "";
  }
  return "";
}

function isoFromExcel(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

// ----------------------------- Summary -----------------------------

function buildSummaryHtml(config: Config, order: ParsedOrder, subject: string, sender: string): string {
  const ok = order.issues.length === 0;
  const td = "border:1px solid #ccc;padding:4px 8px;";
  const row = (label: string, value: string) =>
    `<tr><td style="${td}font-weight:bold;">${esc(label)}</td><td style="${td}">${esc(value) || "<i>(blank)</i>"}</td></tr>`;

  let html = ok
    ? `<p style="color:#0a6e2e;font-weight:bold;">Ready to import into Sage Intacct Order Entry.</p>`
    : `<p style="color:#b00020;font-weight:bold;">Review the import file before uploading - ${order.issues.length} item(s) need attention:</p>` +
      `<ul>${order.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

  html += `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
    row("Customer ID", order.customerId) +
    row("Matched by", order.customerMatch) +
    row("PO / reference", order.poNumber) +
    row("Order date", order.orderDate) +
    row("Requested ship date", order.expDate) +
    row("Comment", order.comment) +
    row("Transaction type / state", `${config.transactionType} / ${config.state}`) +
    row("Original email", `${subject} (from ${sender})`) +
    `</table>`;

  if (order.lines.length > 0) {
    html += `<p style="font-weight:bold;margin-top:12px;">Lines (${order.lines.length})</p>` +
      `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
      `<tr>${["Item ID", "Description", "Qty", "Unit", config.includePrices ? "Price" : "Email price (not imported)"]
        .map((h) => `<th style="${td}background:#f2f2f2;text-align:left;">${h}</th>`).join("")}</tr>` +
      order.lines.map((l) =>
        `<tr><td style="${td}">${esc(l.item)}</td><td style="${td}">${esc(l.description)}</td>` +
        `<td style="${td}text-align:right;">${l.qty}</td><td style="${td}">${esc(l.unit)}</td>` +
        `<td style="${td}text-align:right;">${l.hasPrice ? l.price.toFixed(2) : ""}</td></tr>`).join("") +
      `</table>`;
  }
  return html;
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
