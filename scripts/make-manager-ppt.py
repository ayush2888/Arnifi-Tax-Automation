"""One-off generator for manager brief PPT. Not part of the product runtime."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

NAVY = RGBColor(0x0B, 0x1F, 0x3A)
TEAL = RGBColor(0x0D, 0x94, 0x88)
ACCENT = RGBColor(0xF0, 0xA5, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT = RGBColor(0xF4, 0xF7, 0xFA)
MUTED = RGBColor(0x5A, 0x6A, 0x7A)
DARK = RGBColor(0x1A, 0x2A, 0x3A)
SOFT = RGBColor(0xE6, 0xEF, 0xF2)
TOTAL = 12


def set_run(run, size=18, bold=False, color=DARK, font="Calibri"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font


def add_bg(slide, color=LIGHT):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    sp_tree = slide.shapes._spTree
    sp = shape._element
    sp_tree.remove(sp)
    sp_tree.insert(2, sp)


def add_bar(slide):
    bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.18), prs.slide_height
    )
    bar.fill.solid()
    bar.fill.fore_color.rgb = TEAL
    bar.line.fill.background()


def add_footer(slide, page):
    box = slide.shapes.add_textbox(Inches(0.5), Inches(7.05), Inches(12), Inches(0.35))
    tf = box.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = f"arnibooks  ·  Arnifi internal  ·  Confidential  ·  {page}/{TOTAL}"
    set_run(run, 11, False, MUTED)


def section_header(slide, title, subtitle=None):
    add_bg(slide)
    add_bar(slide)
    t = slide.shapes.add_textbox(Inches(0.55), Inches(0.35), Inches(12), Inches(0.6))
    p = t.text_frame.paragraphs[0]
    r = p.add_run()
    r.text = title
    set_run(r, 32, True, NAVY)
    if subtitle:
        s = slide.shapes.add_textbox(Inches(0.55), Inches(0.95), Inches(12), Inches(0.4))
        p = s.text_frame.paragraphs[0]
        r = p.add_run()
        r.text = subtitle
        set_run(r, 14, False, MUTED)
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.55), Inches(1.4), Inches(2.2), Inches(0.06)
    )
    line.fill.solid()
    line.fill.fore_color.rgb = TEAL
    line.line.fill.background()


def bullets(slide, items, left=0.55, top=1.7, width=12, size=18):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(5.0))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.level = 0
        p.space_after = Pt(10)
        r = p.add_run()
        r.text = "▸  " + item
        set_run(r, size, False, DARK)


def card(slide, x, y, w, h, title, body_lines, title_color=TEAL):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = WHITE
    shape.line.color.rgb = SOFT
    shape.adjustments[0] = 0.08
    t = slide.shapes.add_textbox(
        Inches(x + 0.2), Inches(y + 0.15), Inches(w - 0.4), Inches(0.4)
    )
    p = t.text_frame.paragraphs[0]
    r = p.add_run()
    r.text = title
    set_run(r, 16, True, title_color)
    b = slide.shapes.add_textbox(
        Inches(x + 0.2), Inches(y + 0.55), Inches(w - 0.4), Inches(h - 0.7)
    )
    tf = b.text_frame
    tf.word_wrap = True
    for i, line in enumerate(body_lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(4)
        r = p.add_run()
        r.text = line
        set_run(r, 13, False, DARK)


# 1 Title
slide = prs.slides.add_slide(prs.slide_layouts[6])
bg = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
)
bg.fill.solid()
bg.fill.fore_color.rgb = NAVY
bg.line.fill.background()
accent = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE, 0, Inches(5.9), prs.slide_width, Inches(0.12)
)
accent.fill.solid()
accent.fill.fore_color.rgb = TEAL
accent.line.fill.background()
t = slide.shapes.add_textbox(Inches(0.9), Inches(2.0), Inches(11.5), Inches(1.2))
p = t.text_frame.paragraphs[0]
r = p.add_run()
r.text = "arnibooks"
set_run(r, 54, True, WHITE)
s = slide.shapes.add_textbox(Inches(0.9), Inches(3.3), Inches(11.5), Inches(1.2))
p = s.text_frame.paragraphs[0]
r = p.add_run()
r.text = "Arnifi Ledger Workspace — Project Brief for Leadership"
set_run(r, 24, False, RGBColor(0xB8, 0xD4, 0xE0))
m = slide.shapes.add_textbox(Inches(0.9), Inches(4.5), Inches(11.5), Inches(0.8))
p = m.text_frame.paragraphs[0]
r = p.add_run()
r.text = "What we built · What works today · What comes next"
set_run(r, 16, False, RGBColor(0x8A, 0xA8, 0xB8))
f = slide.shapes.add_textbox(Inches(0.9), Inches(6.3), Inches(11.5), Inches(0.5))
p = f.text_frame.paragraphs[0]
r = p.add_run()
r.text = "Internal bookkeeping product for UAE SME clients  |  Used by Arnifi accountants"
set_run(r, 14, False, WHITE)

# 2 Problem
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(s, "The problem we are solving", "Arnifi accountants serving UAE SME clients")
bullets(
    s,
    [
        "Accountants receive bank statements, invoices and docs → must produce journals, VAT packs, and reports.",
        "Today this is slow, spreadsheet-heavy, and easy to get inconsistent across clients.",
        "Competitors show the UX bar — we need an Arnifi-owned system of record, not vendor lock-in.",
        "Goal: source documents in → journal → ledger → trial balance → P&L / Balance Sheet / Cash Flow.",
        "Product never files with the FTA — accountants prepare packs; filing stays outside the app.",
    ],
)
add_footer(s, 2)

# 3 What is
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(s, "What is arnibooks?", "Internal product name for Arnifi’s ledger workspace")
card(
    s,
    0.55,
    1.7,
    3.9,
    4.4,
    "For whom",
    [
        "Arnifi accountants (not client self-serve yet)",
        "UAE SME bookkeeping & VAT workflows",
        "Multi-client firm model with RLS isolation",
    ],
    NAVY,
)
card(
    s,
    4.7,
    1.7,
    3.9,
    4.4,
    "What it does",
    [
        "Ingest bank statements (PDF/CSV)",
        "OCR extract → review → post journals",
        "Balanced double-entry ledger (IFRS / UAE VAT)",
        "VAT201 draft + dual-control release",
        "Reconcile, period close, P&L/BS, CT report",
    ],
    TEAL,
)
card(
    s,
    8.85,
    1.7,
    3.9,
    4.4,
    "What it is NOT",
    [
        "Not an FTA auto-submitter",
        "Not a full ERP / inventory suite yet",
        "Not client portal (security gate FAIL by default)",
        "Not production with real client data in git",
    ],
    ACCENT,
)
add_footer(s, 3)

# 4 Architecture
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(s, "Technical architecture", "One stack — reproducible locally and in CI")
bullets(
    s,
    [
        "Frontend: Next.js (TypeScript) accountant UI on port 43123",
        "Database: Postgres — journals are the only source of truth; money as integer fils (no floats)",
        "Storage: MinIO (S3-compatible) for private statement PDFs with short-lived signed URLs",
        "Worker: Python background jobs — parse / OCR (local Tesseract eng+ara) behind an Extractor interface",
        "Security: Row-level security by user; IBANs encrypted; portal gate blocks real tenants until PASS",
        "Delivery: Docker Compose full stack; fast local lab = Docker infra + host web/worker (no rebuild every edit)",
    ],
)
add_footer(s, 4)

# 5 Stages
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(
    s,
    "Roadmap delivered (Stages A → E)",
    "Colleague engine retained; screens wired to the real ledger",
)
stages = [
    ("A", "Ledger + thin slice", "COA, balanced journals, period locks, doc→post, draft VAT201"),
    ("B", "VAT release", "Dual-control pack; preparer ≠ approver; download audit; no FTA submit"),
    ("C", "Reconcile / AR-AP", "Bank ↔ open items; control checks; exception queue"),
    ("D1", "Close", "Close checklist; CLOSED months reject new posts"),
    ("D2", "Statements", "P&L / Balance Sheet from ledger; integrity gates"),
    ("E", "Corporate tax", "CT from accounting profit + adjustments; approve-before-download"),
]
for i, (code, name, desc) in enumerate(stages):
    col = i % 3
    row = i // 3
    x = 0.55 + col * 4.15
    y = 1.7 + row * 2.4
    card(
        s,
        x,
        y,
        3.95,
        2.15,
        f"Stage {code} — {name}",
        [desc],
        TEAL if i % 2 == 0 else NAVY,
    )
add_footer(s, 5)

# 6 Working screens
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(
    s,
    "What works in the product today",
    "Menu opens the real notebook (Al Noor demo company)",
)
rows = [
    ("Bank / Transactions", "Live grid of extracted bank rows from the worker"),
    ("Statements", "Upload bank PDF/CSV; column map remembered per bank"),
    ("Ledger / Journals", "Post balanced journals; DB rejects unequal Dr/Cr"),
    ("VAT201", "Totals from posted journals; second person approves download"),
    ("Reconcile", "Match bank activity to open items"),
    ("Close", "Lock a month; closed periods reject new journals"),
    ("Reports", "Profit & Balance Sheet from ledger (Cash Flow still demo)"),
    ("Corporate Tax", "Starts from accounting profit; dual-control download"),
]
box = s.shapes.add_textbox(Inches(0.55), Inches(1.65), Inches(12.2), Inches(5.0))
tf = box.text_frame
tf.word_wrap = True
for i, (name, desc) in enumerate(rows):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.space_after = Pt(6)
    r = p.add_run()
    r.text = name + "  —  "
    set_run(r, 15, True, TEAL)
    r2 = p.add_run()
    r2.text = desc
    set_run(r2, 15, False, DARK)
add_footer(s, 6)

# 7 Integrity
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(
    s,
    "Accounting integrity (non-negotiables)",
    "Why this is a real system of record — not a UI mock",
)
bullets(
    s,
    [
        "Journal is the ONLY source of truth — reports read posted lines; nothing else changes balances.",
        "Money = integer minor units (fils) end-to-end — no floating-point amounts.",
        "Every entry must balance (Dr = Cr) — enforced in the database, not only in app code.",
        "Posted entries are immutable — corrections via reversal + new entry; soft-delete drafts only.",
        "Locked months reject posting / reverse / reclass; dual-control (preparer ≠ approver).",
        "Full audit trail on create / update / post / reverse / match / approve.",
        "UAE VAT rules (5% / zero / exempt / OOS / reverse charge); input VAT needs valid tax invoice TRN.",
    ],
)
add_footer(s, 7)

# 8 Personal delivery
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(
    s,
    "What I personally delivered",
    "Fresh Arnifi-owned repo + phase work on top of the accounting engine",
)
bullets(
    s,
    [
        "Took colleague’s accounting-automation engine as the base (correct core) — did not rewrite the ledger math.",
        "Created / pushed work to Arnifi-owned GitHub: github.com/ayush2888/Arnifi-Tax-Automation",
        "Mapped two notebooks (real books vs sidebar books) and pointed the menu at the real ledger path.",
        "Finished phase wiring: Statements on menu, Ledger uses open period, Bank path for books transactions.",
        "Got the stack running locally (Docker Compose + login demo); fixed build blockers (JSX/lint).",
        "Depersonalized demo login for manager demos; documented fast local lab with host Tesseract.",
        "Clarified real-document lab rules: gitignored samples only; security gate until portal review PASS.",
    ],
)
add_footer(s, 8)

# 9 Demo
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(
    s, "How we demo it (5-minute walkthrough)", "Synthetic company: Al Noor Trading LLC"
)
card(
    s,
    0.55,
    1.7,
    6.0,
    4.5,
    "Walkthrough",
    [
        "1. Open http://127.0.0.1:43123/login → Enter demo",
        "2. Bank — see extracted rows",
        "3. Statements — upload demo CSV or bank PDF",
        "4. Ledger — open a journal (balanced Dr/Cr)",
        "5. VAT201 — draft boxes from posted journals",
        "6. Close / Reports / CT — show period lock & packs",
        "Demo sample: demo-samples/al-noor-bank-demo.csv",
    ],
    TEAL,
)
card(
    s,
    6.85,
    1.7,
    5.9,
    4.5,
    "Important caveats",
    [
        "Demo session (no passwords yet) — role switcher for dual-control",
        "Default security status FAIL = synthetic tenants only",
        "Real PDFs: local lab only; never commit client files",
        "OCR = local Tesseract (eng+ara), not cloud LLM",
        "Expenses & Company Health = placeholders",
        "P&L/BS real; Cash Flow on reports = demo",
    ],
    ACCENT,
)
add_footer(s, 9)

# 10 Next
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(s, "Status vs next milestones", "From credible demo → production pilot")
card(
    s,
    0.55,
    1.7,
    6.0,
    4.5,
    "Done / credible now",
    [
        "Double-entry ledger + VAT path end-to-end",
        "Bank ingest + OCR worker path",
        "Dual-control VAT / CT release model",
        "Period close + statements integrity gates",
        "Unit / e2e / golden test harness in CI",
        "Local runbook for accountants / devs",
    ],
    TEAL,
)
card(
    s,
    6.85,
    1.7,
    5.9,
    4.5,
    "Next (production phases)",
    [
        "1. App chrome polish (Arnifi branding)",
        "2. Document review drawer (correct → post)",
        "3. Harder extraction (bank + tax invoices)",
        "4. Real-document lab packs (gitignored)",
        "5. Portal security PASS → one pilot client",
        "Then: real login/MFA, unify dual notebooks",
    ],
    NAVY,
)
add_footer(s, 10)

# 11 Risks
s = prs.slides.add_slide(prs.slide_layouts[6])
section_header(s, "Risks & controls (talking points)", "What leadership should know")
bullets(
    s,
    [
        "Security gate: no real client docs in product until portal security review = PASS.",
        "Two ledger notebooks still exist historically — menu now prefers real books; full unification is planned.",
        "OCR quality varies on scanned PDFs — local Tesseract first; cloud OCR only if owners approve later.",
        "Product prepares packs; Arnifi/client still files in FTA portal (by design — smaller compliance risk).",
        "Validation path: back-test vs filed goldens → shadow → 3–5 client pilot (not big-bang cutover).",
    ],
)
add_footer(s, 11)

# 12 Ask
s = prs.slides.add_slide(prs.slide_layouts[6])
bg = s.shapes.add_shape(
    MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
)
bg.fill.solid()
bg.fill.fore_color.rgb = NAVY
bg.line.fill.background()
accent = s.shapes.add_shape(
    MSO_SHAPE.RECTANGLE, 0, Inches(5.9), prs.slide_width, Inches(0.12)
)
accent.fill.solid()
accent.fill.fore_color.rgb = TEAL
accent.line.fill.background()
t = s.shapes.add_textbox(Inches(0.9), Inches(2.1), Inches(11.5), Inches(1))
p = t.text_frame.paragraphs[0]
r = p.add_run()
r.text = "Ask of leadership"
set_run(r, 36, True, WHITE)
box = s.shapes.add_textbox(Inches(0.9), Inches(3.3), Inches(11.5), Inches(2.2))
tf = box.text_frame
tf.word_wrap = True
for i, line in enumerate(
    [
        "1. Confirm priority: polish + extraction hardening vs security pilot timeline.",
        "2. Approve collection of anonymised / filed VAT goldens for back-test (on-machine only).",
        "3. Nominate first pilot client after security checklist sign-off.",
    ]
):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.space_after = Pt(10)
    r = p.add_run()
    r.text = line
    set_run(r, 18, False, RGBColor(0xB8, 0xD4, 0xE0))

out = r"c:\Users\india\Desktop\arnibooks-Manager-Brief.pptx"
prs.save(out)
print("SAVED", out)
