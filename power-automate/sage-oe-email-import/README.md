# Email order → Sage O/E import file (Power Automate)

When an order email arrives, this flow:

1. Reads the email (customer #, PO #, dates, ship-to code, comments, and the line-item table).
2. Writes the order into an Excel file in the column layout **Sage 300 O/E Order Entry → File → Import** expects (`Orders` + `Order_Details` sheets).
3. Emails the person who uploads to Sage, attaching **the import file plus every attachment from the original email** (e.g. the customer's PO PDF), with a summary of what was read.
4. Marks the result **READY** or **REVIEW NEEDED**. If anything was missing or unclear (no customer number, a quantity it couldn't read, a bad date…), the email lists exactly what to check before importing.
5. If the flow itself fails, it forwards the original email to that person so the order isn't lost.

```
New email ──► copy template ──► Office Script fills    ──► email to Sage uploader:
(Outlook)     (OneDrive)        Orders / Order_Details      import .xlsx + original attachments
                                 + returns a summary         + READY / REVIEW summary
```

**Built for:** Sage 300 (Accpac) O/E, Microsoft 365 (Outlook + OneDrive for Business). Only **standard** connectors are used, so it needs no premium Power Automate license.
If your Sage is Sage 100 (Sales Order) or Sage Intacct (Order Entry), the flow stays the same but the column layout changes. Send me an example import file and I'll adjust the script.

## Files

| File | What it is |
|---|---|
| `BuildSageOEImport.ts` | The Office Script that reads the email and writes the Excel file. Settings are in `getConfig()` at the top. |
| `Sage_OE_Import_Template.xlsx` | Empty template (just the `Orders` and `Order_Details` sheets). The flow copies it for each email. |
| `samples/order-email.html`, `samples/order-email.txt` | Example order emails the script understands (HTML table and plain text). |
| `samples/OE_Import_SAMPLE.xlsx` | What the script produced from `order-email.html`. Use it for a test import in Sage. |
| `test/` | Offline tests for the script (`./test/run-tests.sh`), which you only need if you change the script. |

---

## 1. One-time setup

### 1a. Confirm the import layout with your Sage company (do this first, about 10 minutes)

Every Sage company can be set up a little differently, so check the file against yours before building the flow:

1. In Sage 300 open **O/E Transactions → Order Entry**, open any existing order, then **File → Export**, choose Excel, and save.
2. Open the export and compare it with `samples/OE_Import_SAMPLE.xlsx`:
   - The sheet names should be `Orders` and `Order_Details`.
   - **ITEM column:** if your export shows item numbers *without* dashes/slashes (e.g. `A11030` instead of `A1-103/0`), set `stripItemSeparators: true` in the script (step 1c).
   - **LINENUM column:** the script numbers lines 32, 64, 96… If your export uses a different spacing, change `lineNumberStep`.
3. In a **test company**, change the customer and item numbers in `OE_Import_SAMPLE.xlsx` to real ones, then run **File → Import** in Order Entry. Fix anything Sage complains about before going live (tell me the error and I'll adjust the script).

### 1b. Put the template in OneDrive

In OneDrive for Business, create these folders and upload the template:

```
Sage OE Imports/
├── Template/Sage_OE_Import_Template.xlsx
└── Generated/                 ← the flow saves one import file per email here
```

> Tip: build the flow under a shared or service account (or add co-owners) so it keeps running if the person who built it leaves.

### 1c. Create the Office Script

1. Open `Sage_OE_Import_Template.xlsx` in **Excel for the web** → **Automate** tab → **New Script**.
2. Delete the sample code, paste in all of `BuildSageOEImport.ts`, and rename the script to **Build Sage OE Import** (click the name at the top). Save.
3. Review the settings in `getConfig()`:

| Setting | Default | Change it when… |
|---|---|---|
| `customerBySenderDomain` | empty | Customers don't put their account # in the email. Add `{ domain: "acme.com", customer: "ACME01" }` per customer. |
| `includePrices` | `false` | You want the price in the email to override Sage's price list. Leave `false` to let Sage price the order (email prices still show in the notification for comparison). |
| `defaultLocation` | `""` (Sage default) | Every order ships from one location, e.g. `"1"`. |
| `defaultUnit` | `""` (item's selling unit) | You want a fixed unit when the email has none. |
| `stripItemSeparators` | `false` | Your Sage export shows unformatted item numbers (see 1a). |
| `requirePoNumber` | `true` | A missing PO should *not* mark the order for review. |
| `lineNumberStep` | `32` | Your export's LINENUM spacing is different. |
| `headerFields`, `lineColumns` | common labels | Your customers use other labels, e.g. "Acct Code:" or "Part No." (add a regex to the list). |

The script doesn't need a manual run in Excel; the flow runs it.

---

## 2. Build the flow

Go to **make.powerautomate.com → Create → Automated cloud flow**, name it `Email orders → Sage OE import`, and pick the trigger **When a new email arrives (V3)** (Office 365 Outlook).

> **Rename each action to the name in bold as soon as you add it.** The expressions below refer to those names (spaces become `_`, e.g. `Copy template` → `Copy_template`).
> **Time zone:** the expressions use `'Central Standard Time'`. Replace it with yours (e.g. `'Eastern Standard Time'`).
> To enter an expression, click in the field, choose the **fx** (expression) option, paste, then **Add**.

### Trigger: When a new email arrives (V3)

| Field | Value |
|---|---|
| Folder | `Inbox`, or a dedicated folder such as `Sage Orders` (set up an Outlook rule to move order emails there) |
| Include Attachments | **Yes** |
| Only with Attachments | **Yes** (choose No if some orders arrive without a PO attachment) |
| From / Subject Filter | Optional, e.g. Subject Filter `PO` |

*Orders go to a shared mailbox?* Use **When a new email arrives in a shared mailbox (V2)** instead. It has the same outputs, so everything below still applies.

### Step 1: Scope → **Process order**

Add a **Scope** action. Steps 2–11 all go *inside* it, so that one failure step (step 12) can catch any problem.

### Step 2: Compose → **File name**

Inputs (expression):
```
concat('OE_Import_', formatDateTime(convertFromUtc(utcNow(), 'Central Standard Time'), 'yyyyMMdd-HHmmss'), '_', substring(guid(), 0, 4), '.xlsx')
```

### Step 3: OneDrive for Business – Copy file → **Copy template**

| Field | Value |
|---|---|
| File | browse to `/Sage OE Imports/Template/Sage_OE_Import_Template.xlsx` |
| Destination File Path | type `/Sage OE Imports/Generated/` then insert **Outputs** of *File name* |
| Overwrite | No |

### Step 4: Excel Online (Business) – Run script → **Run script**

| Field | Value |
|---|---|
| Location | OneDrive for Business |
| Document Library | OneDrive |
| File | expression `body('Copy_template')?['Id']` (or pick **Id** from *Copy template* in dynamic content) |
| Script | Build Sage OE Import |
| emailBody | dynamic content **Body** (trigger) |
| subject | dynamic content **Subject** |
| sender | dynamic content **From** |
| receivedDate | expression `formatDateTime(convertFromUtc(triggerOutputs()?['body/receivedDateTime'], 'Central Standard Time'), 'yyyy-MM-dd')` |

The four parameter boxes appear after you choose the script.

### Step 5: Delay → **Wait for save**

Count `10`, Unit `Second`. This gives OneDrive time to save the script's changes before the file is read.

### Step 6: OneDrive for Business – Get file content → **Get import file**

File: expression `body('Copy_template')?['Id']`

### Step 7: Filter array → **Real attachments**

| Field | Value |
|---|---|
| From | expression `triggerOutputs()?['body/attachments']` |
| Condition | click **Edit in advanced mode** and paste `@not(equals(item()?['isInline'], true))` |

This drops signature logos and other inline images, so only real attachments get passed along.

### Step 8: Select → **Attachment list**

| Field | Value |
|---|---|
| From | expression `body('Real_attachments')` |
| Map | key `Name` → expression `item()?['name']`<br>key `ContentBytes` → expression `item()?['contentBytes']` |

### Step 9: Compose → **All attachments**

Inputs (expression):
```
union(body('Attachment_list'), createArray(addProperty(addProperty(json('{}'), 'Name', outputs('File_name')), 'ContentBytes', body('Get_import_file')?['$content'])))
```

The result is the original email's attachments plus the new import file, in the format *Send an email* expects.

### Step 10: Office 365 Outlook – Send an email (V2) → **Notify Sage uploader**

| Field | Value |
|---|---|
| To | the person or group who uploads to Sage |
| Subject | expression (below) |
| Body | click the **`</>`** (code view) button and paste the HTML below |
| Attachments | under *Advanced parameters* add **Attachments**, click **Switch to input entire array**, and use expression `outputs('All_attachments')` |
| Importance | expression `if(equals(body('Run_script')?['result']?['status'], 'READY'), 'Normal', 'High')` |

Subject:
```
concat(if(equals(body('Run_script')?['result']?['status'], 'READY'), 'Sage OE import ready', 'REVIEW NEEDED - Sage OE import'), ' | PO ', body('Run_script')?['result']?['poNumber'], ' | Customer ', body('Run_script')?['result']?['customer'])
```

Body (code view):
```html
<p>An order email was converted into a Sage O/E import file. The import file (<b>@{outputs('File_name')}</b>) and the attachments from the original email are attached.</p>
@{body('Run_script')?['result']?['summaryHtml']}
<p>To upload: Sage 300 → O/E Transactions → Order Entry → File → Import → choose the attached .xlsx. Then attach the customer's PO to the order as usual.</p>
```

### Step 11 (optional): Office 365 Outlook – Move email (V2) → **Move to Processed**

Message Id: expression `triggerOutputs()?['body/id']`. Folder: e.g. `Inbox/Processed` (create the folder first).
This keeps the inbox tidy and shows at a glance which emails were handled.

### Step 12: Failure safety net → **Forward on failure**

Add this **after** (outside) the *Process order* scope: **Office 365 Outlook – Forward an email (V2)**

| Field | Value |
|---|---|
| Message Id | expression `triggerOutputs()?['body/id']` |
| To | same person as step 10 |
| Comment | expression (below) |

```
concat('The automatic Sage OE import failed for this email. Please enter it manually. Flow run: https://make.powerautomate.com/environments/', workflow()?['tags']?['environmentName'], '/flows/', workflow()?['name'], '/runs/', workflow()?['run']?['name'])
```

Then open the action's **Settings → Run after**, select *Process order*, check **has failed** and **has timed out**, and uncheck **is successful**.

**Save**, and the flow is live.

---

## 3. Test it

1. Send an order email to the watched mailbox with a PDF attached. For the body, copy the text of `samples/order-email.txt`, or open `samples/order-email.html` in a browser and copy/paste it into Outlook so the table comes through.
2. Within a minute or two, the uploader should get **"Sage OE import ready | PO 77311 | Customer 1100"** with `OE_Import_….xlsx` and your PDF attached. The run shows up under **My flows → the flow → Run history**.
3. Send one email *without* a customer number. It should arrive as **REVIEW NEEDED**, listing what's missing.
4. Import a generated file into a **test** Sage company before you use it in the live one.

## 4. What the script recognizes

**Order header lines** (one per line, `Label: value`, or a two-column table):

| Sage field | Labels it looks for (any capitalization) |
|---|---|
| CUSTOMER | Customer #, Customer No/Number/ID/Code, Account #, Acct #, Bill-To # (falls back to `customerBySenderDomain`) |
| PONUMBER | PO, PO #, P.O. Number, Purchase Order, Customer PO (falls back to a PO number in the subject) |
| ORDDATE | Order Date, PO Date, Date Ordered (falls back to the date the email arrived) |
| EXPDATE | Ship Date, Requested/Required Ship Date, Delivery Date, Required Date, Due Date, Need By, Ship By |
| SHIPTO | Ship-To Code / Location / ID (a Sage ship-to *code*, not an address) |
| LOCATION | Warehouse, Location Code (otherwise `defaultLocation`) |
| COMMENT | Comments, Notes, Special Instructions |
| REFERENCE / DESC | Filled automatically from the email subject / sender |

**Line items:** the first table (HTML table, tab-separated, `|`-separated, or columns aligned with spaces) whose header row has an item column (*Item, Item #, SKU, Part #, Product…*) and a quantity column (*Qty, Quantity…*). Unit (*UOM, U/M, Unit*) and price (*Price, Unit Price, Cost*) columns are optional, and a unit written in the quantity cell ("10 EA") is picked up too. *Line #* and *Ext. Price / Total* columns are ignored, and the table stops at a Subtotal/Total/Tax/Freight row. If there is no table, lines like `Item: A1-103/0 Qty: 5` also work.

Dates can be written `10/19/2026`, `10/19/26`, `2026-10-19`, `Oct 19, 2026`, or `19-Oct-2026` (numeric dates are read month-first).

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| The attached import file is the empty template | Increase the delay in step 5 to 20–30 seconds. |
| *Run script* fails with "file not found" or "locked" | Add a 5-second Delay between *Copy template* and *Run script*. |
| Signature logos still attached | Change step 7's condition to `@and(not(equals(item()?['isInline'], true)), not(startsWith(item()?['contentType'], 'image/')))` (only if customers never send image POs). |
| Sage: "item not found" on import | Check the item format (see 1a) and set `stripItemSeparators`. |
| Sage rejects a header field | Compare your export (1a). Header columns are built in `writeOrder()` in the script; remove that field there. |
| Every order comes back REVIEW NEEDED | The emails use labels the script doesn't know. Add them to `headerFields` / `lineColumns`, or send me a sample email. |
| Orders are PDF-only (no details in the body) | The script flags "No line items found" and the uploader keys the lines from the attached PDF. Reading PDFs automatically needs AI Builder (a premium license). If the POs come as Excel/CSV attachments, the script can be extended to read those instead. |

Limits worth knowing: Outlook won't send emails over roughly 25–35 MB including attachments; *Run script* allows 1,600 runs per user per day.
