"""Builds the workbooks in this folder's parent:

  Intacct_OE_Import_Template.xlsx - the template the flow copies for every email, with the
                                    header row from Sage-OrderEntry_Import_headers.csv
  Customer_Map.xlsx               - the customer reference file the flow reads each run
  samples/OE_Import_SAMPLE.xlsx   - what the script writes for samples/order-email.html
  samples/OE_Import_SAMPLE.csv    - the CSV the flow attaches for the same email

Run run-tests.sh first; it writes build/sample-output.* from the real script.
"""
import csv
import datetime
import json
import os
import shutil
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

HEADER_FONT = Font(name="Arial", size=10, bold=True)
BODY_FONT = Font(name="Arial", size=10)
EXCEL_EPOCH = datetime.date(1899, 12, 30)


def save(wb, name):
    wb.save(os.path.join(ROOT, name))
    print("wrote", name)


def import_sheet(ws, rows, formats=None):
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row, start=1):
            fmt = formats[r - 1][c - 1] if formats else ""
            if fmt == "mm/dd/yyyy" and isinstance(value, (int, float)):
                value = EXCEL_EPOCH + datetime.timedelta(days=value)
            cell = ws.cell(row=r, column=c, value=None if value == "" else value)
            cell.font = HEADER_FONT if r == 1 else BODY_FONT
            if fmt and fmt != "General":
                cell.number_format = fmt
    for c in range(1, len(rows[0]) + 1):
        width = max(len(str(row[c - 1])) for row in rows if c - 1 < len(row))
        ws.column_dimensions[get_column_letter(c)].width = min(max(width + 2, 10), 50)
    ws.freeze_panes = "A2"


# Import template: exactly the header row Intacct gave NPH.
with open(os.path.join(ROOT, "Sage-OrderEntry_Import_headers.csv"), encoding="utf-8-sig", newline="") as f:
    headers = next(csv.reader(f))
wb = Workbook()
ws = wb.active
ws.title = "OrderEntry_Import"
import_sheet(ws, [headers])
save(wb, "Intacct_OE_Import_Template.xlsx")

# Customer map: an Excel table the flow reads with "List rows present in a table".
wb = Workbook()
ws = wb.active
ws.title = "Customer Map"
columns = ["Customer ID", "Customer Name", "Sender Emails", "Sender Domains", "Other Names or Codes"]
example = ["EXAMPLE-001", "Example Customer Inc", "buyer@example.com; ap@example.com", "example.com", "EXCUST; 1100"]
ws.append(columns)
ws.append(example)
for c, width in enumerate([16, 30, 40, 24, 30], start=1):
    ws.column_dimensions[get_column_letter(c)].width = width
    ws.cell(row=1, column=c).font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    ws.cell(row=2, column=c).font = Font(name="Arial", size=10, color="0000FF")
table = Table(displayName="CustomerMap", ref="A1:E2")
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
ws.add_table(table)
ws.freeze_panes = "A2"

help_ws = wb.create_sheet("How to use")
notes = [
    ("Customer map for the email -> Intacct Order Entry flow", True),
    ("", False),
    ("One row per customer on the Customer Map sheet. Keep it as an Excel table named CustomerMap (the flow reads that table).", False),
    ("Replace the blue example row with your customers. Add rows by typing directly under the table.", False),
    ("", False),
    ("Customer ID - the Intacct customer ID, exactly as in Intacct (IDs are case-sensitive). Required.", False),
    ("Customer Name - the name as customers write it in emails or on POs. Inc/LLC/Corp and punctuation are ignored.", False),
    ("Sender Emails - addresses that send this customer's orders. Separate several with ;", False),
    ("Sender Domains - e.g. acme.com. Leave blank for shared domains (gmail.com, outlook.com) or a domain several customers share.", False),
    ("Other Names or Codes - anything else that identifies them in an email: an old account number, a DBA name, a short code. Separate with ;", False),
    ("", False),
    ("How the flow picks the customer, first match wins:", True),
    ("1. A customer ID or code written in the email (Customer #, Account #...)", False),
    ("2. The sender's email address, then addresses quoted in a forwarded email", False),
    ("3. The sender's domain", False),
    ("4. A 'Customer:', 'Bill To:' or 'Sold To:' name in the email, then a customer name anywhere in the text", False),
    ("A step only decides if it points at exactly one customer; otherwise the order is marked REVIEW NEEDED.", False),
]
for r, (text, bold) in enumerate(notes, start=1):
    cell = help_ws.cell(row=r, column=1, value=text or None)
    cell.font = Font(name="Arial", size=10, bold=bold)
    cell.alignment = Alignment(wrap_text=True, vertical="top")
help_ws.column_dimensions["A"].width = 110
help_ws["A1"].font = Font(name="Arial", size=12, bold=True)
save(wb, "Customer_Map.xlsx")

# Samples from the real script run.
sample_json = os.path.join(HERE, "build", "sample-output.json")
if not os.path.exists(sample_json):
    sys.exit("build/sample-output.json missing - run ./run-tests.sh first")
with open(sample_json) as f:
    sample = json.load(f)
wb = Workbook()
ws = wb.active
ws.title = sample["name"]
import_sheet(ws, sample["rows"], sample["formats"])
save(wb, os.path.join("samples", "OE_Import_SAMPLE.xlsx"))
shutil.copyfile(os.path.join(HERE, "build", "sample-output.csv"), os.path.join(ROOT, "samples", "OE_Import_SAMPLE.csv"))
print("wrote", os.path.join("samples", "OE_Import_SAMPLE.csv"))
