# Email order → Sage Intacct Order Entry import (Power Automate)

When an order email arrives, this flow:

1. Reads the email: PO number, dates, special instructions, and the line-item table.
2. Looks up the **Intacct customer ID** in your customer reference file (`Customer_Map.xlsx`), using the sender's address, their domain, a customer name or code in the email, and so on.
3. Fills in your **Intacct Order Entry import template**, one row per order line, and saves it both as Excel and as **CSV** (Intacct's import screen only accepts CSV).
4. Emails the person who uploads to Intacct. The email carries the CSV, the Excel copy, and **every attachment from the original email** (e.g. the customer's PO PDF), plus a summary of what was read.
5. Marks the result **READY** or **REVIEW NEEDED**. If anything was missing or unclear (customer not found, a line with no item ID, a bad date…), the email lists exactly what to check before importing.
6. If the flow itself fails, it forwards the original email to that person so the order isn't lost.

```
New email ─► copy template ─► read Customer_Map ─► Office Script fills    ─► save .csv ─► email to Intacct uploader:
(Outlook)    (OneDrive)       (Excel table)        the template, finds         (OneDrive)   .csv + .xlsx + original attachments
                                                   the customer ID                          + READY / REVIEW summary
```

Only **standard** Power Automate connectors are used (Outlook, OneDrive for Business, Excel Online), so it needs no premium license.

## Files

| File | What it is |
|---|---|
| `BuildSageOEImport.ts` | The Office Script that reads the email and fills the import file. Settings are in `getConfig()` at the top. |
| `Intacct_OE_Import_Template.xlsx` | Your Intacct Order Entry import template (header row from `Sage-OrderEntry_Import_headers.csv`). The flow copies it for each email. |
| `Customer_Map.xlsx` | Customer reference file: Intacct customer ID ↔ names, sender emails, domains, and other codes. The flow reads it on every run. |
| `samples/order-email.html`, `samples/order-email.txt` | Example order emails the script understands. |
| `samples/OE_Import_SAMPLE.csv` / `.xlsx` | What the flow produced for `order-email.html`. |
| `test/` | Offline tests for the script (`./test/run-tests.sh`), which you only need if you change the script. |

---

## 1. Decisions to confirm before going live

The script follows your template's columns exactly:

`TRANSACTIONTYPE, DATE, GLPOSTINGDATE, CUSTOMER_ID, DATEDUE, DEPARTMENTID, LOCATIONID, LINE, ITEMID, PRICE, REFERENCENO, STATE, CLASSID, MEMO`

This is what goes into each column today. Anything marked ⚠ needs your answer:

| Column | Filled with | Setting in `getConfig()` |
|---|---|---|
| TRANSACTIONTYPE | `Sales Order`. ⚠ Must match your Order Entry transaction definition name exactly (Order Entry → Setup → Transaction definitions). | `transactionType` |
| DATE, GLPOSTINGDATE | Order date from the email; otherwise the date the email arrived | |
| CUSTOMER_ID | Looked up in `Customer_Map.xlsx` (see section 4) | |
| DATEDUE | ⚠ The email's requested ship / need-by date; otherwise the order date | `dueDateSource`: `"requested"`, `"order"`, or `"blank"` |
| DEPARTMENTID, LOCATIONID, CLASSID | ⚠ Blank. Fill in your dimension IDs if every order uses the same ones. | `fixedValues` |
| LINE | 1, 2, 3… | |
| ITEMID | Item number from the email, exactly as written (Intacct IDs are case-sensitive) | `uppercaseItems` |
| PRICE | ⚠ The line's amount from the email (a *Price* / *Unit Price* column if there is one, otherwise *Amount* / *Total*). Lines without one are left blank. `($50.00)` imports as `-50`. | `includePrices` (set `false` to always leave PRICE blank) |
| REFERENCENO | Customer PO number | |
| STATE | ⚠ `Draft`, so each order is opened in Intacct (attach the PO there) and then submitted. Use `Pending` to import orders ready to go. | `state` |
| MEMO | ⚠ The customer's item description from the email | `columns` → `itemDescription` |

> **Quantity:** your invoices never show quantities, so every line imports as **quantity 1**, and the line's amount goes into PRICE. Your template has no QUANTITY column, so Intacct applies its default. If Intacct ever rejects the import for a missing quantity, add a `QUANTITY` column to the template and the script fills it with `1` (setting: `defaultQuantity`). As a safety net, if an email *does* show a quantity other than 1, the order is marked REVIEW NEEDED, because importing it as 1 × unit price would under-bill.

## 2. One-time setup

### 2a. Put the files in OneDrive

In OneDrive for Business, create this layout:

```
Sage OE Imports/
├── Template/Intacct_OE_Import_Template.xlsx
├── Customer_Map.xlsx
└── Generated/                 ← the flow saves each email's .xlsx and .csv here
```

If you change your Intacct template later, open the new CSV from Intacct in Excel, **Save As** `.xlsx`, and replace `Intacct_OE_Import_Template.xlsx`. The script reads whatever columns the template has.

> Tip: build the flow under a shared or service account (or add co-owners) so it keeps running if the person who built it leaves.

### 2b. Fill in the customer map

Open `Customer_Map.xlsx` (the *How to use* sheet explains each column) and replace the blue example row with your customers, one row per customer:

| Customer ID | Customer Name | Sender Emails | Sender Domains | Other Names or Codes |
|---|---|---|---|---|
| C-1001 | Northwind Traders, Inc. | jane.ortiz@northwind.com; ap@northwind.com | northwind.com | NWT; old acct 4471 |

Already have a reference file? Paste its columns into the table. As long as there's a **Customer ID** column, the other columns are optional, and you can rename or reorder them. The script recognizes columns whose names contain *mail*, *domain*, *name*, or *code/alias/other/account*. Keep it as an Excel **table named `CustomerMap`**.

### 2c. Create the Office Script

1. Open `Intacct_OE_Import_Template.xlsx` in **Excel for the web** → **Automate** tab → **New Script**.
2. Delete the sample code, paste in all of `BuildSageOEImport.ts`, and rename the script to **Build Sage OE Import** (click the name at the top). Save.
3. Set the values from section 1 in `getConfig()` (transaction type, state, dimension IDs…).

The script doesn't need a manual run in Excel; the flow runs it.

---

## 3. Build the flow

Go to **make.powerautomate.com → Create → Automated cloud flow**, name it `Email orders → Intacct OE import`, and pick the trigger **When a new email arrives (V3)** (Office 365 Outlook).

> **Rename each action to the name in bold as soon as you add it.** The expressions below refer to those names (spaces become `_`).
> **Time zone:** the expressions use `'Central Standard Time'`. Replace it with yours (e.g. `'Eastern Standard Time'`).
> To enter an expression, click the field, choose **fx**, paste, then **Add**.

### Trigger: When a new email arrives (V3)

| Field | Value |
|---|---|
| Folder | `Inbox`, or a dedicated folder such as `Intacct Orders` (set up an Outlook rule to move order emails there) |
| Include Attachments | **Yes** |
| Only with Attachments | **Yes** (choose No if some orders arrive without a PO attachment) |
| From / Subject Filter | Optional, e.g. Subject Filter `PO` |

*Orders go to a shared mailbox?* Use **When a new email arrives in a shared mailbox (V2)**. It has the same outputs.

### Step 1: Scope → **Process order**

Add a **Scope**. Steps 2–13 go *inside* it, so that one failure step (step 14) can catch any problem.

### Step 2: Compose → **Base name**

```
concat('OE_Import_', formatDateTime(convertFromUtc(utcNow(), 'Central Standard Time'), 'yyyyMMdd-HHmmss'), '_', substring(guid(), 0, 4))
```

### Step 3: OneDrive for Business – Copy file → **Copy template**

| Field | Value |
|---|---|
| File | `/Sage OE Imports/Template/Intacct_OE_Import_Template.xlsx` |
| Destination File Path | expression `concat('/Sage OE Imports/Generated/', outputs('Base_name'), '.xlsx')` |
| Overwrite | No |

### Step 4: Excel Online (Business) – List rows present in a table → **List customer map**

| Field | Value |
|---|---|
| Location / Document Library | OneDrive for Business / OneDrive |
| File | `/Sage OE Imports/Customer_Map.xlsx` |
| Table | `CustomerMap` |

**Important:** open this action's **Settings**, turn **Pagination** on, and set **Threshold** to `5000`. Without that, Power Automate reads only the first 256 customers.

### Step 5: Excel Online (Business) – Run script → **Run script**

| Field | Value |
|---|---|
| Location / Document Library | OneDrive for Business / OneDrive |
| File | expression `body('Copy_template')?['Id']` |
| Script | Build Sage OE Import |
| emailBody | dynamic content **Body** (trigger) |
| subject | dynamic content **Subject** |
| sender | dynamic content **From** |
| receivedDate | expression `formatDateTime(convertFromUtc(triggerOutputs()?['body/receivedDateTime'], 'Central Standard Time'), 'yyyy-MM-dd')` |
| customerMapJson | expression `string(body('List_customer_map')?['value'])` |

### Step 6: OneDrive for Business – Create file → **Save CSV**

| Field | Value |
|---|---|
| Folder Path | `/Sage OE Imports/Generated` |
| File Name | expression `concat(outputs('Base_name'), '.csv')` |
| File Content | expression `body('Run_script')?['result']?['csv']` |

### Step 7: Delay → **Wait for save**

Count `10`, Unit `Second`. This gives OneDrive time to save the script's changes to the .xlsx.

### Step 8: OneDrive for Business – Get file content → **Get import file**

File: expression `body('Copy_template')?['Id']`

### Step 9: Filter array → **Real attachments**

From: `triggerOutputs()?['body/attachments']`. **Edit in advanced mode**: `@not(equals(item()?['isInline'], true))`. This drops signature logos and other inline images.

### Step 10: Select → **Attachment list**

From: `body('Real_attachments')`. Map: `Name` → `item()?['name']`, `ContentBytes` → `item()?['contentBytes']`

### Step 11: Compose → **All attachments**

```
union(body('Attachment_list'), createArray(addProperty(addProperty(json('{}'), 'Name', concat(outputs('Base_name'), '.csv')), 'ContentBytes', base64(body('Run_script')?['result']?['csv'])), addProperty(addProperty(json('{}'), 'Name', concat(outputs('Base_name'), '.xlsx')), 'ContentBytes', body('Get_import_file')?['$content'])))
```

### Step 12: Office 365 Outlook – Send an email (V2) → **Notify Intacct uploader**

| Field | Value |
|---|---|
| To | the person or group who uploads to Intacct |
| Subject | expression (below) |
| Body | click **`</>`** (code view) and paste the HTML below |
| Attachments | *Advanced parameters* → **Attachments** → **Switch to input entire array** → `outputs('All_attachments')` |
| Importance | `if(equals(body('Run_script')?['result']?['status'], 'READY'), 'Normal', 'High')` |

Subject:
```
concat(if(equals(body('Run_script')?['result']?['status'], 'READY'), 'Intacct OE import ready', 'REVIEW NEEDED - Intacct OE import'), ' | PO ', body('Run_script')?['result']?['poNumber'], ' | ', body('Run_script')?['result']?['customerId'])
```

Body (code view):
```html
<p>An order email was converted into a Sage Intacct Order Entry import. Attached: <b>@{outputs('Base_name')}.csv</b> (upload this one), the same rows as .xlsx, and the attachments from the original email.</p>
@{body('Run_script')?['result']?['summaryHtml']}
<p>To upload: in Sage Intacct go to <b>Company → Setup → Configuration → Import data</b> (or the Import link on the Order Entry transaction list), choose <b>Order Entry transactions</b>, select the attached .csv, and pick date format <b>MM/DD/YYYY</b>. Then open the new order and attach the customer's PO.</p>
```

### Step 13 (optional): Office 365 Outlook – Move email (V2) → **Move to Processed**

Message Id: `triggerOutputs()?['body/id']`. Folder: e.g. `Inbox/Processed` (create the folder first).

### Step 14: Failure safety net → **Forward on failure**

**After** (outside) the scope, add **Office 365 Outlook – Forward an email (V2)**:

| Field | Value |
|---|---|
| Message Id | `triggerOutputs()?['body/id']` |
| To | same person as step 12 |
| Comment | expression below |

```
concat('The automatic Intacct OE import failed for this email. Please enter it manually. Flow run: https://make.powerautomate.com/environments/', workflow()?['tags']?['environmentName'], '/flows/', workflow()?['name'], '/runs/', workflow()?['run']?['name'])
```

Then **Settings → Run after** → *Process order* → check **has failed** and **has timed out**, and uncheck **is successful**.

**Save**, and the flow is live.

---

## 4. How the customer ID is found

The script works through these steps in order, and the first step that points at **exactly one** customer wins:

1. A customer ID written in the email (*Customer #*, *Customer ID*, *Account #*…). It's checked against the map's **Customer ID** column (any capitalization, but the map's spelling is what gets used) and then against **Other Names or Codes**.
2. The sender's address (**Sender Emails**), then addresses quoted in a forwarded email.
3. The sender's domain (**Sender Domains**).
4. A *Customer:*, *Company:*, *Bill To:* or *Sold To:* name, compared with **Customer Name** / **Other Names or Codes**. Inc, LLC, Corp and punctuation are ignored.
5. A customer name or code found anywhere in the email text.

If a step matches two customers (e.g. two accounts at the same domain), it moves on to the next step. When nothing settles it, the order is marked REVIEW NEEDED and the summary names the candidates. If the email gives an ID that isn't in the map, the order is also flagged, even when another step found the customer. Every notification says how the customer was matched.

Rather not keep a separate file? You can paste customers into `customerMap` in `getConfig()` instead. Entries there and in `Customer_Map.xlsx` are combined.

## 5. Test it

1. Add a test customer to `Customer_Map.xlsx` with **your own** email address under *Sender Emails*.
2. Send an order email to the watched mailbox with a PDF attached. Use the text of `samples/order-email.txt`, or open `samples/order-email.html` in a browser and paste it into Outlook so the table comes through.
3. Within a minute or two, the uploader gets **Intacct OE import ready | PO 45-10872 | <your test customer ID>** (for the .html sample) with the .csv, .xlsx, and your PDF. The .txt sample says `Account #: 1100`, so it comes back REVIEW NEEDED unless you add `1100` under the test customer's *Other Names or Codes*. That's a good check that the flagging works.
4. Import the CSV into an Intacct **sandbox** first, if you have one.

## 6. What the script recognizes in emails

| Value | Labels it looks for (any capitalization) |
|---|---|
| Customer ID / code | Customer #, Customer No/ID/Code, Account #, Acct #, Bill-To # |
| Customer name | Customer, Customer Name, Company, Bill To, Sold To |
| PO number | PO, PO #, P.O. Number, Purchase Order, Customer PO (falls back to a PO number in the subject) |
| Order date | Order Date, PO Date, Date Ordered (falls back to the date the email arrived) |
| Ship / need-by date | Ship Date, Requested Ship Date, Delivery Date, Required Date, Due Date, Need By, Ship By |
| Instructions | Comments, Notes, Special Instructions. These are shown in the notification; add `MESSAGE` to the template to import them. |

**Line items:** the first table (HTML table, tab-separated, `|`-separated, or columns aligned with spaces) whose header row has an item column (*Item, Item #, SKU, Part #, Product…*) next to a description or amount column, or a *Description* column next to an amount column. Amounts come from *Price / Unit Price / Rate*, or else *Amount / Total / Ext. Price*. Every line is quantity 1; a *Qty* column is read only to flag quantities other than 1. *Line #* columns are ignored, and the table stops at a Subtotal/Total/Tax/Freight row. A line without an item ID is kept, and the order is flagged so someone fills in ITEMID. Lines like `Item: INST-100 Amount: $1,250.00` also work.

Dates can be written `10/19/2026`, `10/19/26`, `2026-10-19`, `Oct 19, 2026`, or `19-Oct-2026` (numeric dates are read month-first).

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Intacct: "customer not found" | The ID in `Customer_Map.xlsx` doesn't match Intacct exactly (IDs are case-sensitive). |
| Intacct: "invalid transaction type" | Set `transactionType` to your exact Order Entry transaction definition name. |
| Intacct: a dimension is required | Put the ID in `fixedValues` (LOCATIONID, DEPARTMENTID, CLASSID). |
| Intacct: dates rejected | Pick MM/DD/YYYY on the import screen, or change `dateFormat` to match what you pick. |
| Customer always REVIEW NEEDED | Add the sender's address or domain (or the name they use) to `Customer_Map.xlsx`. If you have more than 256 customers, check that pagination is on in step 4. |
| The attached .xlsx is the empty template | Increase the delay in step 7 to 20–30 seconds. (The .csv comes straight from the script and isn't affected.) |
| *Run script* fails with "file not found" or "locked" | Add a 5-second Delay between *Copy template* and *Run script*. |
| Signature logos still attached | Change step 9's condition to `@and(not(equals(item()?['isInline'], true)), not(startsWith(item()?['contentType'], 'image/')))` |
| Orders are PDF-only (nothing in the body) | The order is flagged "No line items found" and the uploader keys the lines from the PDF. Reading PDFs automatically needs AI Builder (a premium license). If POs arrive as Excel/CSV attachments, the script can be extended to read those. |

Limits worth knowing: Outlook won't send emails over roughly 25–35 MB including attachments; *Run script* allows 1,600 runs per user per day.
