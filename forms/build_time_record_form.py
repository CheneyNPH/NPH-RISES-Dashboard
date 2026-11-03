"""Build a clean, fillable Contractor Time Record PDF (vector, no scanned image).

Usage: python build_time_record_form.py OUTPUT.pdf  (needs reportlab + pypdf)
"""
import sys

from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

OUT = sys.argv[1]
W, H = landscape(letter)  # 792 x 612
LM = 54  # left margin
RM = W - 54  # right edge of content
N_ROWS = 10

BOLD, REG = "Times-Bold", "Times-Roman"
GRAY = Color(0.80, 0.80, 0.80)
FIELD_BG = None  # transparent so printed form matches the original
NO_BORDER = None


def y(top):
    """Convert a distance from the top of the page to a reportlab y."""
    return H - top


c = canvas.Canvas(OUT, pagesize=(W, H))
c.setTitle("Contractor Time Record")
c.setSubject("Contractor Information / Time Record (fillable)")
c.setAuthor("")
c.setCreator("")
form = c.acroForm


def text_field(name, x, top, w, h, tooltip, size=10, multiline=False, align=0):
    form.textfield(
        name=name,
        tooltip=tooltip,
        x=x,
        y=y(top + h),
        width=w,
        height=h,
        fontName="Helvetica",
        fontSize=size,
        borderWidth=0,
        borderColor=NO_BORDER,
        fillColor=FIELD_BG,
        textColor=black,
        forceBorder=False,
        fieldFlags="multiline" if multiline else "",
        maxlen=0,
    )


# ---------------------------------------------------------------- heading
c.setFont(BOLD, 12)
c.drawString(LM, y(48), "Contractor Information")
c.drawString(LM, y(63), "(Not for IRF Medical Director Agreements)")

# ---------------------------------------------------------------- name / month / year
row_top = 95
c.setFont(BOLD, 12)
c.drawString(LM, y(row_top), "Name:")
name_x0, name_x1 = LM + 42, LM + 300
c.drawString(name_x1 + 16, y(row_top), "Month:")
month_x0, month_x1 = name_x1 + 60, name_x1 + 160
c.drawString(month_x1 + 16, y(row_top), "Year:")
year_x0, year_x1 = month_x1 + 50, month_x1 + 125

c.setLineWidth(0.75)
for x0, x1 in ((name_x0, name_x1), (month_x0, month_x1), (year_x0, year_x1)):
    c.line(x0, y(row_top + 2), x1, y(row_top + 2))
text_field("Name", name_x0, row_top - 13, name_x1 - name_x0, 15, "Contractor name", size=11)
text_field("Month", month_x0, row_top - 13, month_x1 - month_x0, 15, "Month", size=11)
text_field("Year", year_x0, row_top - 13, year_x1 - year_x0, 15, "Year", size=11)

# ---------------------------------------------------------------- services rendered
sv_top = 125
c.setFont(BOLD, 12)
label = "Services Rendered:"
c.drawString(LM, y(sv_top), label)
lx = LM + c.stringWidth(label, BOLD, 12) + 4
c.setFont(REG, 12)
sub = "(Physician Advisor, Medical Director, etc.):"
c.drawString(lx, y(sv_top), sub)
sv_x0 = lx + c.stringWidth(sub, REG, 12) + 6
c.line(sv_x0, y(sv_top + 2), RM, y(sv_top + 2))
text_field("Services Rendered", sv_x0, sv_top - 13, RM - sv_x0, 15,
           "Services rendered (Physician Advisor, Medical Director, etc.)", size=11)

# ---------------------------------------------------------------- time record title
c.setFont(BOLD, 12)
c.drawString(LM, y(157), "Time Record: Complete All Fields using Legend Below")

# ---------------------------------------------------------------- table
cols = [  # (header lines, width, field name, tooltip, multiline, font size)
    (["Date"], 58, "Date", "Date", False, 9),
    (["Code", "(Admin.", "Only)"], 52, "Code", "Code (Admin. only)", False, 9),
    (["Function", "(Legend)"], 60, "Function", "Function (see legend)", False, 9),
    (["Participant/ Policy Name", "Or", "Number of Charts"], 168, "Participant",
     "Participant / policy name or number of charts", True, 0),
    (["Detailed Description of Service Provided"], 268, "Description",
     "Detailed description of service provided", True, 0),
    (["Total Time", "Spent on", "Function"], 78, "Total Time",
     "Total time spent on function", False, 9),
]
assert abs(sum(cl[1] for cl in cols) - (RM - LM)) < 0.01

t_top = 170
hdr_h = 54
row_h = 23
t_bot = t_top + hdr_h + N_ROWS * row_h

xs = [LM]
for cl in cols:
    xs.append(xs[-1] + cl[1])

# gray "admin only" column (header + body)
c.setFillColor(GRAY)
c.rect(xs[1], y(t_bot), xs[2] - xs[1], t_bot - t_top, stroke=0, fill=1)
c.setFillColor(black)

# header text, vertically centred, left aligned like the original
for i, (lines, w, *_rest) in enumerate(cols):
    lh = 13.5
    block = lh * len(lines)
    start = t_top + (hdr_h - block) / 2 + 10.5
    for j, ln in enumerate(lines):
        c.setFont(BOLD, 11)
        if lines == ["Detailed Description of Service Provided"]:
            c.drawCentredString(xs[i] + w / 2, y(start + j * lh), ln)
        else:
            c.drawString(xs[i] + 4, y(start + j * lh), ln)

# grid
c.setLineWidth(0.6)
c.setStrokeColor(Color(0.35, 0.35, 0.35))
c.rect(LM, y(t_bot), RM - LM, t_bot - t_top, stroke=1, fill=0)
for x in xs[1:-1]:
    c.line(x, y(t_top), x, y(t_bot))
c.line(LM, y(t_top + hdr_h), RM, y(t_top + hdr_h))
for r in range(1, N_ROWS):
    yy = t_top + hdr_h + r * row_h
    c.line(LM, y(yy), RM, y(yy))

# row fields (created row by row so Tab moves across, then down)
pad = 1.5
for r in range(N_ROWS):
    top = t_top + hdr_h + r * row_h
    for i, (_lines, w, fname, tip, multi, size) in enumerate(cols):
        text_field(
            f"{fname} {r + 1}",
            xs[i] + pad,
            top + pad,
            w - 2 * pad,
            row_h - 2 * pad,
            f"Row {r + 1}: {tip}",
            size=size if size else 9,
            multiline=multi,
        )

# ---------------------------------------------------------------- totals block
tot_top = t_bot
tot_row = 24
tot_split = LM + 300
tot_right = LM + 450
c.rect(LM, y(tot_top + 2 * tot_row), tot_right - LM, 2 * tot_row, stroke=1, fill=0)
c.line(LM, y(tot_top + tot_row), tot_right, y(tot_top + tot_row))
c.line(tot_split, y(tot_top), tot_split, y(tot_top + 2 * tot_row))
c.setFillColor(black)
for k, lab in enumerate(("Total From Page 4", "Grand Total")):
    base = tot_top + k * tot_row + 16
    c.setFont(BOLD, 12)
    c.drawString(LM + 6, y(base), lab)
    arrow_x = LM + 6 + c.stringWidth(lab, BOLD, 12) + 8
    c.setFont(BOLD, 10)
    arrows = ">" * 18
    c.drawString(arrow_x, y(base), arrows)
    text_field(
        "Total From Page 4" if k == 0 else "Grand Total",
        tot_split + pad,
        tot_top + k * tot_row + pad,
        tot_right - tot_split - 2 * pad,
        tot_row - 2 * pad,
        lab,
        size=10,
    )

# ---------------------------------------------------------------- attestation / admin
at_top = tot_top + 2 * tot_row + 18
c.setFont(BOLD, 12)
c.drawString(LM, y(at_top), "Attestation:")
admin_x = LM + 300
c.drawString(admin_x, y(at_top), "Administrative Use Only:")
box_top = at_top + 6
box_h = H - 22 - box_top
text_field("Attestation", LM, box_top, admin_x - LM - 18, box_h, "Attestation",
           size=10, multiline=True)
text_field("Administrative Use Only", admin_x, box_top, RM - admin_x, box_h,
           "Administrative use only", size=10, multiline=True)

c.showPage()
c.save()
print("wrote", OUT, "table bottom", t_bot, "attest box", box_top, box_h)

# ---------------------------------------------------------------- post-process
# Auto-size text in the long multi-line columns, and ask viewers to rebuild
# field appearances so typed text always renders.
from pypdf import PdfReader, PdfWriter
from pypdf.generic import BooleanObject, NameObject, TextStringObject

reader = PdfReader(OUT)
writer = PdfWriter(clone_from=reader)
for annot in writer.pages[0]["/Annots"]:
    a = annot.get_object()
    if str(a.get("/T", "")).startswith(("Participant", "Description")):
        a[NameObject("/DA")] = TextStringObject("/Helv 0 Tf 0 0 0 rg")
writer._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
writer.add_metadata({"/Title": "Contractor Time Record", "/Producer": ""})
with open(OUT, "wb") as fh:
    writer.write(fh)
