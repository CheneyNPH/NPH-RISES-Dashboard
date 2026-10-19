/**
 * Build Sage OE Import - Office Script (Excel for the web > Automate)
 *
 * Power Automate calls this with the Excel Online (Business) "Run script" action,
 * pointed at a fresh copy of Sage_OE_Import_Template.xlsx. It reads one order email
 * (HTML or plain text), writes the order to the "Orders" and "Order_Details" sheets
 * using Sage 300 O/E Order Entry import field names, and returns a summary that the
 * flow drops into the notification email.
 *
 * Anything the script is unsure about is listed in `issues` and the status becomes
 * "REVIEW" instead of "READY", so a person checks the file before importing it.
 *
 * To match your own order emails or Sage company defaults, edit getConfig() only.
 */

interface ImportResult {
  status: string;      // "READY" or "REVIEW"
  customer: string;
  poNumber: string;
  orderDate: string;   // yyyy-mm-dd
  lineCount: number;
  issues: string;      // one issue per line; empty when status is READY
  summaryHtml: string; // HTML block for the notification email body
}

interface Config {
  orderNumber: string;          // ORDNUMBER value for new orders
  defaultLocation: string;      // "" = let Sage default it
  defaultUnit: string;          // "" = let Sage use the item's selling unit
  lineNumberStep: number;       // LINENUM spacing between detail lines
  includePrices: boolean;       // false = Sage prices the lines from the price list
  requirePoNumber: boolean;
  uppercaseItems: boolean;
  stripItemSeparators: boolean; // true = "A1-103/0" becomes "A11030"
  customerBySenderDomain: DomainCustomer[];
  headerFields: FieldLabels[];
  lineColumns: FieldLabels[];
  maxLengths: FieldLength[];
}

interface DomainCustomer { domain: string; customer: string; }
interface FieldLabels { field: string; labels: RegExp[]; }
interface FieldLength { field: string; max: number; }

interface OrderLine {
  item: string;
  description: string;
  qty: number;
  unit: string;
  price: number;
  hasPrice: boolean;
}

interface ParsedOrder {
  customer: string;
  poNumber: string;
  orderDate: string; // yyyy-mm-dd
  expDate: string;   // yyyy-mm-dd or ""
  shipTo: string;
  location: string;
  reference: string;
  description: string;
  comment: string;
  lines: OrderLine[];
  issues: string[];
}

function getConfig(): Config {
  return {
    orderNumber: "*** NEW ***",
    defaultLocation: "",
    defaultUnit: "",
    lineNumberStep: 32,
    includePrices: false,
    requirePoNumber: true,
    uppercaseItems: true,
    stripItemSeparators: false,

    // Used when the email has no customer number, e.g. { domain: "acme.com", customer: "ACME01" }
    customerBySenderDomain: [],

    // "Label: value" lines in the email body. Each regex matches the label only;
    // the script adds the ":" / "#" / table-cell separator itself.
    headerFields: [
      { field: "CUSTOMER", labels: [
        /cust(?:omer)?\.?\s*(?:number|num|no\.?|#|id|code|acct|account)/,
        /(?:account|acct)\.?\s*(?:number|num|no\.?|#)?/,
        /bill[\s-]*to\s*(?:number|no\.?|#|code|id)/,
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
      { field: "SHIPTO", labels: [
        /ship[\s-]*to\s*(?:code|location|loc|id|#|no\.?)/,
      ] },
      { field: "LOCATION", labels: [
        /warehouse(?:\s*(?:code|id))?/, /location\s*code/,
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

    // Sage 300 O/E field lengths; longer values are cut and flagged for review.
    maxLengths: [
      { field: "CUSTOMER", max: 12 }, { field: "PONUMBER", max: 22 },
      { field: "SHIPTO", max: 6 }, { field: "LOCATION", max: 6 },
      { field: "REFERENCE", max: 60 }, { field: "DESC", max: 60 },
      { field: "COMMENT", max: 250 }, { field: "ITEM", max: 24 }, { field: "ORDUNIT", max: 10 },
    ],
  };
}

function main(
  workbook: ExcelScript.Workbook,
  emailBody: string,
  subject: string,
  sender: string,
  receivedDate: string
): ImportResult {
  const config = getConfig();
  const order = parseOrder(config, emailBody || "", subject || "", sender || "", receivedDate || "");
  writeOrder(workbook, config, order);

  return {
    status: order.issues.length === 0 ? "READY" : "REVIEW",
    customer: order.customer,
    poNumber: order.poNumber,
    orderDate: order.orderDate,
    lineCount: order.lines.length,
    issues: order.issues.join("\n"),
    summaryHtml: buildSummaryHtml(config, order, subject || "", sender || ""),
  };
}

// ----------------------------- Parsing -----------------------------

function parseOrder(config: Config, body: string, subject: string, sender: string, receivedDate: string): ParsedOrder {
  const text = toPlainText(body);
  const issues: string[] = [];

  let customer = findHeaderValue(config, text, "CUSTOMER");
  if (!customer) {
    const domainMatch = /@([A-Za-z0-9.-]+)/.exec(sender);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : "";
    for (const entry of config.customerBySenderDomain) {
      if (domain === entry.domain.toLowerCase() || endsWith(domain, "." + entry.domain.toLowerCase())) {
        customer = entry.customer;
      }
    }
  }
  if (!customer) {
    issues.push("Customer number not found in the email - enter CUSTOMER on the Orders sheet.");
  }

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
      issues.push(`Ship/required date "${expDateText}" not recognized - left blank so Sage defaults it.`);
    }
  }

  const location = findHeaderValue(config, text, "LOCATION") || config.defaultLocation;
  const lines = findLines(config, text, issues);
  if (lines.length === 0) {
    issues.push("No line items found in the email body - add them on the Order_Details sheet.");
  }

  return {
    customer: limit(config, "CUSTOMER", customer.toUpperCase(), issues),
    poNumber: limit(config, "PONUMBER", poNumber, issues),
    orderDate: orderDate,
    expDate: expDate,
    shipTo: limit(config, "SHIPTO", findHeaderValue(config, text, "SHIPTO").toUpperCase(), issues),
    location: limit(config, "LOCATION", location.toUpperCase(), issues),
    reference: limit(config, "REFERENCE", subject.trim(), []),
    description: limit(config, "DESC", sender ? `Email order from ${sender}` : "Email order", []),
    comment: limit(config, "COMMENT", findHeaderValue(config, text, "COMMENT"), issues),
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
        unit: unit.toUpperCase(),
        price: isNaN(price) ? 0 : price,
        hasPrice: !isNaN(price),
      });
    }
    if (lines.length > 0) {
      return normalizeItems(config, lines, issues);
    }
  }

  // Fallback: one line item per line, e.g. "Item: A1-103/0  Qty: 5"
  const lines: OrderLine[] = [];
  const inline = /(?:item|sku|part)\s*(?:#|no\.?|number)?\s*[:#]\s*([A-Za-z0-9][\w\-\/.]*)[\s\S]*?(?:qty|quantity)\s*[:=x]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]{1,10})?/i;
  for (const raw of textLines) {
    const m = inline.exec(raw);
    if (m) {
      lines.push({ item: m[1], description: "", qty: parseNumber(m[2]), unit: (m[3] || "").toUpperCase(), price: 0, hasPrice: false });
    }
  }
  return normalizeItems(config, lines, issues);
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

function normalizeItems(config: Config, lines: OrderLine[], issues: string[]): OrderLine[] {
  for (const line of lines) {
    let item = line.item.trim();
    if (config.uppercaseItems) {
      item = item.toUpperCase();
    }
    if (config.stripItemSeparators) {
      item = item.replace(/[^A-Za-z0-9]/g, "");
    }
    line.item = limit(config, "ITEM", item, issues);
    line.unit = limit(config, "ORDUNIT", line.unit || config.defaultUnit, issues);
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

function limit(config: Config, field: string, value: string, issues: string[]): string {
  for (const f of config.maxLengths) {
    if (f.field === field && value.length > f.max) {
      issues.push(`${field} "${value}" is longer than Sage allows (${f.max}) - cut to "${value.slice(0, f.max)}".`);
      return value.slice(0, f.max);
    }
  }
  return value;
}

function endsWith(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
}

// ----------------------------- Writing -----------------------------

type CellValue = string | number;

function writeOrder(workbook: ExcelScript.Workbook, config: Config, order: ParsedOrder): void {
  // Header: one order, linked to its detail lines by ORDUNIQ. Empty optional fields
  // are left out entirely so Sage applies its own defaults instead of a blank.
  const headerFields: string[] = ["ORDUNIQ", "ORDNUMBER", "CUSTOMER"];
  const headerValues: CellValue[] = [1, config.orderNumber, order.customer];
  const optional: [string, CellValue][] = [
    ["SHIPTO", order.shipTo],
    ["PONUMBER", order.poNumber],
    ["LOCATION", order.location],
    ["ORDDATE", order.orderDate ? excelDate(order.orderDate) : ""],
    ["EXPDATE", order.expDate ? excelDate(order.expDate) : ""],
    ["REFERENCE", order.reference],
    ["DESC", order.description],
    ["COMMENT", order.comment],
  ];
  for (const pair of optional) {
    if (pair[1] !== "") {
      headerFields.push(pair[0]);
      headerValues.push(pair[1]);
    }
  }

  const anyUnit = order.lines.some((l) => l.unit !== "");
  const anyPrice = config.includePrices && order.lines.some((l) => l.hasPrice);
  const detailFields: string[] = ["ORDUNIQ", "LINENUM", "LINETYPE", "ITEM", "QTYORDERED"];
  if (anyUnit) { detailFields.push("ORDUNIT"); }
  if (anyPrice) { detailFields.push("UNITPRICE"); }
  const detailRows: CellValue[][] = order.lines.map((line, i) => {
    const row: CellValue[] = [1, (i + 1) * config.lineNumberStep, 1, line.item, line.qty];
    if (anyUnit) { row.push(line.unit); }
    if (anyPrice) { row.push(line.hasPrice ? line.price : ""); }
    return row;
  });
  if (anyUnit && order.lines.some((l) => l.unit === "")) {
    order.issues.push("Some lines have a unit of measure and some do not - fill in ORDUNIT or remove the column.");
  }
  if (anyPrice && order.lines.some((l) => !l.hasPrice)) {
    order.issues.push("Some lines have a price and some do not - fill in UNITPRICE or remove the column.");
  }

  const ordersSheet = writeSheet(workbook, "Orders", headerFields, [headerValues], ["ORDDATE", "EXPDATE"]);
  const detailSheet = writeSheet(workbook, "Order_Details", detailFields, detailRows, []);
  ordersSheet.setPosition(0);
  detailSheet.setPosition(1);

  // Sage reads every sheet in the file, so remove anything else (e.g. a default "Sheet1").
  for (const sheet of workbook.getWorksheets()) {
    const name = sheet.getName();
    if (name !== "Orders" && name !== "Order_Details") {
      sheet.delete();
    }
  }
}

function writeSheet(
  workbook: ExcelScript.Workbook,
  name: string,
  fields: string[],
  rows: CellValue[][],
  dateFields: string[]
): ExcelScript.Worksheet {
  const sheet = workbook.getWorksheet(name) || workbook.addWorksheet(name);
  sheet.getRange().clear();

  const values: CellValue[][] = [fields as CellValue[]].concat(rows);
  sheet.getRangeByIndexes(0, 0, values.length, fields.length).setValues(values);
  sheet.getRangeByIndexes(0, 0, 1, fields.length).getFormat().getFont().setBold(true);

  if (rows.length > 0) {
    for (const field of dateFields) {
      const col = fields.indexOf(field);
      if (col >= 0) {
        sheet.getRangeByIndexes(1, col, rows.length, 1).setNumberFormatLocal("yyyy-mm-dd");
      }
    }
  }
  sheet.getRangeByIndexes(0, 0, values.length, fields.length).getFormat().autofitColumns();
  return sheet;
}

// ----------------------------- Summary -----------------------------

function buildSummaryHtml(config: Config, order: ParsedOrder, subject: string, sender: string): string {
  const ok = order.issues.length === 0;
  const td = "border:1px solid #ccc;padding:4px 8px;";
  const row = (label: string, value: string) =>
    `<tr><td style="${td}font-weight:bold;">${esc(label)}</td><td style="${td}">${esc(value) || "<i>(blank)</i>"}</td></tr>`;

  let html = ok
    ? `<p style="color:#0a6e2e;font-weight:bold;">Ready to import into Sage O/E.</p>`
    : `<p style="color:#b00020;font-weight:bold;">Review the import file before uploading - ${order.issues.length} item(s) need attention:</p>` +
      `<ul>${order.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

  html += `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
    row("Customer", order.customer) +
    row("PO number", order.poNumber) +
    row("Order date", order.orderDate) +
    row("Ship / required date", order.expDate) +
    row("Ship-to code", order.shipTo) +
    row("Location", order.location) +
    row("Comment", order.comment) +
    row("Original email", `${subject} (from ${sender})`) +
    `</table>`;

  if (order.lines.length > 0) {
    html += `<p style="font-weight:bold;margin-top:12px;">Lines (${order.lines.length})</p>` +
      `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
      `<tr>${["Item", "Description", "Qty", "Unit", config.includePrices ? "Unit price" : "Email price (not imported)"]
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
