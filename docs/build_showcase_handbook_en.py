from __future__ import annotations

from pathlib import Path

from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SCREENS = ROOT / "tmp" / "pdfs" / "screens"
OUT_DIR = ROOT / "output" / "pdf"
OUT = OUT_DIR / "AI_Medical_Agent_Evaluation_Platform_Showcase_Handbook_EN.pdf"
W, H = landscape(A4)

NAVY = HexColor("#002147")
NAVY_2 = HexColor("#0B315C")
BLUE = HexColor("#1769AA")
CRIMSON = HexColor("#D10A2C")
GREEN = HexColor("#148A67")
AMBER = HexColor("#C98613")
INK = HexColor("#13243A")
MUTED = HexColor("#607085")
LINE = HexColor("#D9E2EC")
PALE = HexColor("#F3F6FA")
PALE_BLUE = HexColor("#EDF5FC")
PALE_RED = HexColor("#FFF2F4")
PALE_GREEN = HexColor("#ECF8F4")

FONT_REG = "Inter"
FONT_BOLD = "Inter-Bold"
pdfmetrics.registerFont(TTFont(FONT_REG, r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\arialbd.ttf"))


def pstyle(size=11, leading=None, color=INK, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s{size}-{bold}-{align}-{color}",
        fontName=FONT_BOLD if bold else FONT_REG,
        fontSize=size,
        leading=leading or size * 1.45,
        textColor=color,
        alignment=align,
        splitLongWords=True,
    )


def para(c, text, x, y_top, width, height, size=11, leading=None, color=INK, bold=False, align=TA_LEFT):
    p = Paragraph(text, pstyle(size, leading, color, bold, align))
    _, h = p.wrap(width, height)
    p.drawOn(c, x, y_top - h)
    return h


def round_rect(c, x, y, w, h, fill=white, stroke=LINE, radius=9, lw=0.8):
    c.setLineWidth(lw)
    c.setStrokeColor(stroke)
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


def tag(c, text, x, y, fill, color, width=None):
    width = width or max(54, 12 + len(text) * 5.2)
    c.setFillColor(fill)
    c.roundRect(x, y, width, 19, 9.5, stroke=0, fill=1)
    c.setFillColor(color)
    c.setFont(FONT_BOLD, 7.7)
    c.drawCentredString(x + width / 2, y + 5.7, text)
    return width


def header(c, section, title, subtitle=None, page=None):
    c.setFillColor(CRIMSON)
    c.rect(28, H - 41, 4, 16, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 8.5)
    c.drawString(41, H - 36, section.upper())
    c.setFillColor(INK)
    title_size = 22
    available = W - 56
    measured = pdfmetrics.stringWidth(title, FONT_BOLD, title_size)
    if measured > available:
        title_size = max(17, title_size * available / measured)
    c.setFont(FONT_BOLD, title_size)
    c.drawString(28, H - 70, title)
    if subtitle:
        para(c, subtitle, 29, H - 81, W - 58, 32, size=9.2, leading=13, color=MUTED)
    c.setStrokeColor(LINE)
    c.line(28, H - 105, W - 28, H - 105)
    if page:
        footer(c, page)


def footer(c, page):
    c.setStrokeColor(LINE)
    c.line(28, 25, W - 28, 25)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.2)
    c.drawString(28, 12, "AI Medical Agent Evaluation Platform | Research Prototype | 13 Aug 2026")
    c.drawRightString(W - 28, 12, f"{page:02d}")


def image_cover(c, path, x, y, w, h, radius=8, stroke=LINE, crop=True):
    path = Path(path)
    with Image.open(path) as src:
        src = src.convert("RGB")
        sw, sh = src.size
        target = w / h
        ratio = sw / sh
        if crop:
            if ratio > target:
                new_w = int(sh * target)
                left = (sw - new_w) // 2
                src = src.crop((left, 0, left + new_w, sh))
            else:
                new_h = int(sw / target)
                top = (sh - new_h) // 2
                src = src.crop((0, top, sw, top + new_h))
        tmp = SCREENS / f"_en_crop_{path.stem}_{int(w)}x{int(h)}.jpg"
        src.save(tmp, quality=92)
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(x, y, w, h, radius)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(ImageReader(tmp), x, y, w, h, preserveAspectRatio=False, mask="auto")
    c.restoreState()
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=0)


def stat(c, x, y, w, label, value, note, accent=CRIMSON):
    round_rect(c, x, y, w, 75, fill=white)
    c.setFillColor(accent)
    c.roundRect(x + 12, y + 22, 33, 33, 7, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 11)
    c.drawCentredString(x + 28.5, y + 33.5, value[:4])
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 9.2)
    c.drawString(x + 55, y + 48, label)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.1)
    c.drawString(x + 55, y + 31, note)


def card_text(c, x, y, w, h, title, body, accent=BLUE, number=None):
    round_rect(c, x, y, w, h, fill=white)
    if number is not None:
        c.setFillColor(accent)
        c.circle(x + 22, y + h - 23, 12, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 9)
        c.drawCentredString(x + 22, y + h - 26, str(number))
        tx = x + 42
    else:
        c.setFillColor(accent)
        c.rect(x, y + h - 5, w, 5, stroke=0, fill=1)
        tx = x + 14
    para(c, title, tx, y + h - 13, w - (tx - x) - 12, 30, size=10, bold=True)
    para(c, body, x + 14, y + h - 47, w - 28, h - 56, size=7.8, leading=11.2, color=MUTED)


def flow_arrow(c, x1, y, x2, color=BLUE):
    c.setStrokeColor(color)
    c.setLineWidth(1.8)
    c.line(x1, y, x2, y)
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(x2, y)
    p.lineTo(x2 - 7, y + 4)
    p.lineTo(x2 - 7, y - 4)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def bullet_list(c, items, x, y_top, width, size=8.4, leading=12, color=INK, gap=5):
    y = y_top
    for item in items:
        c.setFillColor(CRIMSON)
        c.circle(x + 3.5, y - 6, 2.3, stroke=0, fill=1)
        h = para(c, item, x + 13, y, width - 13, 60, size=size, leading=leading, color=color)
        y -= h + gap
    return y


def new_page(c):
    c.showPage()


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    c = Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("AI Medical Agent Evaluation Platform - Showcase Handbook")
    c.setAuthor("NTU AI Safety & Evaluation Research Prototype")
    c.setSubject("P0 MVP implementation, evidence, architecture and roadmap")

    # 01 Cover
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    image_cover(c, SCREENS / "desktop-workspace.png", 360, 0, W - 360, H, radius=0, stroke=NAVY)
    c.setFillColor(Color(0, 0.13, 0.28, alpha=0.18))
    c.rect(360, 0, W - 360, H, stroke=0, fill=1)
    c.setFillColor(CRIMSON)
    c.rect(0, H - 12, W, 12, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 17)
    c.drawString(34, H - 54, "NTU")
    c.setFont(FONT_REG, 8.5)
    c.drawString(86, H - 51, "AI Safety & Evaluation")
    tag(c, "RESEARCH PROTOTYPE", 34, H - 105, CRIMSON, white, 124)
    para(c, "AI Medical Agent<br/>Evaluation Platform", 34, H - 142, 292, 150, size=28, leading=37, color=white, bold=True)
    para(c, "SHOWCASE HANDBOOK", 36, H - 265, 290, 25, size=11, leading=15, color=HexColor("#BFD0E4"), bold=True)
    para(c, "Clinician-grounded evaluation of a virtual doctor's response to longitudinal chronic-care data", 36, H - 303, 285, 78, size=10.5, leading=17, color=white)
    c.setFillColor(HexColor("#BFD0E4"))
    c.setFont(FONT_REG, 8.3)
    c.drawString(36, 51, "P0 MVP | v0.2.0-deepseek")
    c.drawString(36, 35, "13 August 2026 | Simulated data only")
    new_page(c)

    # 02 Executive summary
    header(c, "01 | Executive Summary", "What has been completed?", "A runnable P0 loop from patient selection to model review, clinician feedback and persistent records.", 2)
    c.setFillColor(NAVY)
    c.roundRect(28, 330, 785, 125, 11, stroke=0, fill=1)
    para(c, "In one sentence", 48, 430, 115, 25, size=9.5, color=HexColor("#AFC4DC"), bold=True)
    para(c, "A clinician-facing platform for evaluating one AI virtual doctor's response to a longitudinal chronic-care case, while capturing structured ratings and comments as future Evaluator Ground Truth.", 48, 397, 715, 90, size=15, leading=23, color=white, bold=True)
    stat(c, 28, 230, 185, "Workflow screens", "09", "Sign-in to feedback admin", BLUE)
    stat(c, 228, 230, 185, "Rubric dimensions", "06", "1-5 plus safety checks", CRIMSON)
    stat(c, 428, 230, 185, "Core entities", "05", "Cases, runs, ratings, feedback, imports", GREEN)
    stat(c, 628, 230, 185, "Automated tests", "4/4", "All currently passing", AMBER)
    card_text(c, 28, 61, 247, 139, "Implemented", "Patient library, optional data intake, three-column review workspace, server-side DeepSeek integration, clinician rubrics, two feedback channels, history and CSV export.", GREEN)
    card_text(c, 297, 61, 247, 139, "Current purpose", "Demonstrate the clinician workflow, gather design feedback and validate the software loop using simulated or approved de-identified cases.", BLUE)
    card_text(c, 566, 61, 247, 139, "Explicit boundary", "This is not a medical device or clinical decision-support system. Formal authentication, multi-reviewer reliability and an automatic Evaluator remain future work.", CRIMSON)
    new_page(c)

    # 03 Supervisor feedback response
    header(c, "02 | Supervisor Feedback", "Response to the four design questions", "Current capability is separated from the next design adjustment to avoid overstating the prototype.", 3)
    questions = [
        ("1", "Patient data availability", "<b>Response:</b> A built-in simulated dataset is already available, so doctors can directly select patients. Dataset upload is also supported when needed.<br/><br/><b>Adjustment:</b> Make the patient library the default entry point and treat upload as an optional administrator function, not a required clinician step.", GREEN),
        ("2", "Longitudinal visualization", "<b>Implemented:</b> Patient summary, diagnoses, allergies, clinical timeline and trend tables for HbA1c, eGFR, UACR and blood pressure.<br/><br/><b>Adjustment:</b> Add filtering, abnormal-value highlighting, medication changes, compact summaries and linked trend-event exploration for longer records.", BLUE),
        ("3", "Interactive clinician input", "<b>Implemented:</b> Case search, six rubric scores, safety checks, issue tags, required case feedback and separate platform feedback.<br/><br/><b>Adjustment:</b> Add a patient-specific clinical query box so doctors can ask questions and receive answers grounded only in the selected longitudinal record.", CRIMSON),
        ("4", "Trace-back to evidence", "<b>Current status:</b> Not yet implemented as clickable provenance. The record is visible next to the answer, but individual claims are not technically linked to source events.<br/><br/><b>Adjustment:</b> Add citation markers that open the exact lab, encounter, medication event or source-document excerpt used by the model.", AMBER),
    ]
    for i, (n, title, body, accent) in enumerate(questions):
        col = i % 2
        row = i // 2
        x = 28 + col * 398
        y = 276 - row * 190
        round_rect(c, x, y, 377, 170, fill=white)
        c.setFillColor(accent)
        c.circle(x + 27, y + 140, 15, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 10)
        c.drawCentredString(x + 27, y + 136.5, n)
        para(c, title, x + 51, y + 154, 305, 26, size=10.2, bold=True)
        para(c, body, x + 18, y + 122, 341, 116, size=7.6, leading=11.1, color=MUTED)
    new_page(c)

    # 04 Research basis
    header(c, "03 | Research Basis", "Why was the platform designed this way?", "The design applies principles from open-ended medical evaluation, physician rubrics and task-specific clinical readiness.", 4)
    card_text(c, 28, 280, 375, 195, "HealthBench: physician-written rubrics", "HealthBench contains 5,000 realistic health conversations and 48,562 contextual criteria created by 262 physicians. It evaluates open-ended responses across behavioural axes such as accuracy, completeness, communication, context awareness and instruction following.<br/><br/><b>Design implication:</b> collect structured clinician scores plus free-text feedback instead of relying on one aggregate score.", BLUE)
    card_text(c, 438, 280, 375, 195, "MAST perspective: readiness is task-specific", "An isolated benchmark score cannot establish clinical readiness. Longitudinal care requires context maintenance, repeated assessment, safety, harm avoidance and calibrated uncertainty; evaluation frameworks must also evolve with model capabilities.<br/><br/><b>Design implication:</b> show longitudinal records, define the task precisely and record provider, model and prompt versions.", CRIMSON)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 80, 785, 165, 10, stroke=0, fill=1)
    para(c, "Research principle to product mechanism", 48, 222, 260, 28, size=11.5, bold=True)
    mappings = [
        ("Open-ended medical outputs", "Case, response and rubric shown in one workspace"),
        ("Clinician judgement as current Ground Truth", "Six scores + case feedback + reviewer binding"),
        ("Explicit task and context", "Longitudinal chronic-care case + one agent response"),
        ("Safety cannot be hidden by the mean", "Safety dimension + critical Yes/No + issue tags"),
        ("Reproducible and evolving evaluation", "Provider, model, prompt and run-status metadata"),
    ]
    y = 190
    for left, right in mappings:
        c.setFillColor(white)
        c.roundRect(48, y - 4, 215, 24, 5, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont(FONT_BOLD, 7.2)
        c.drawString(58, y + 4, left)
        flow_arrow(c, 273, y + 8, 299, CRIMSON)
        c.setFillColor(INK)
        c.setFont(FONT_REG, 7.5)
        c.drawString(311, y + 4, right)
        y -= 29
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 6.6)
    c.drawRightString(W - 30, 36, "Sources: Arora et al., HealthBench, arXiv:2505.08775 (2025); Goh et al., Nature Medicine, DOI:10.1038/s41591-026-04539-8 (2026).")
    new_page(c)

    # 05 workflow
    header(c, "04 | Workflow", "End-to-end evaluation flow", "Patient selection is the normal clinician entry point; data intake remains an optional supporting capability.", 5)
    steps = [
        ("1", "Select patient", "Choose an existing simulated longitudinal case"),
        ("2", "Review context", "Summary, timeline, trends and key clinical events"),
        ("3", "Run virtual doctor", "Backend calls DeepSeek and records versions"),
        ("4", "Clinician review", "Six scores, safety checks and case feedback"),
        ("5", "Persist result", "Assessment record and review history"),
        ("6", "Improve platform", "Separate interface and workflow feedback"),
    ]
    y = 335
    x0 = 35
    bw = 118
    gap = 15
    for i, (n, title, note) in enumerate(steps):
        x = x0 + i * (bw + gap)
        round_rect(c, x, y, bw, 120, fill=white)
        c.setFillColor(CRIMSON if i in (2, 3) else NAVY_2)
        c.circle(x + bw / 2, y + 91, 17, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 12)
        c.drawCentredString(x + bw / 2, y + 87, n)
        para(c, title, x + 8, y + 66, bw - 16, 24, size=8.7, bold=True, align=TA_CENTER)
        para(c, note, x + 9, y + 42, bw - 18, 45, size=6.6, leading=9.2, color=MUTED, align=TA_CENTER)
        if i < len(steps) - 1:
            flow_arrow(c, x + bw + 2, y + 60, x + bw + gap - 3, CRIMSON)
    c.setFillColor(PALE)
    c.roundRect(28, 87, 785, 205, 11, stroke=0, fill=1)
    para(c, "Two feedback channels, two purposes", 48, 267, 280, 26, size=11.5, bold=True)
    card_text(c, 48, 117, 335, 125, "Case Feedback | Clinical Ground Truth", "Is the AI response accurate, complete and safe? Stored with Case ID, Agent Run, rubric version and reviewer for future Evaluator research.", CRIMSON)
    card_text(c, 458, 117, 335, 125, "Platform Feedback | Product improvement", "Is the interface clear and where does the workflow fail? Stored with topic, clarity rating, page, comment and status in the administrator inbox.", BLUE)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.8)
    c.drawCentredString(W / 2, 99, "Key design rule: interface feedback must not contaminate clinical evaluation data.")
    new_page(c)

    # 06 intake + cases
    header(c, "05 | Product Walkthrough", "Existing patient data and case selection", "A built-in simulated dataset supports direct selection; upload is retained as an optional capability.", 6)
    image_cover(c, SCREENS / "desktop-cases.png", 28, 195, 500, 280, crop=False)
    image_cover(c, SCREENS / "desktop-data-intake.png", 548, 195, 265, 280, crop=True)
    tag(c, "PRIMARY CLINICIAN ENTRY | CASE LIBRARY", 43, 208, NAVY, white, 206)
    tag(c, "OPTIONAL | DATA INTAKE", 563, 208, AMBER, white, 130)
    card_text(c, 28, 60, 245, 112, "Default workflow", "Doctors directly select an existing patient. Search and status filtering are available, and each review concerns one patient and one virtual-doctor response.", GREEN)
    card_text(c, 298, 60, 245, 112, "Built-in data", "The platform includes simulated longitudinal chronic-care cases for demonstration and workflow validation without requiring an upload step.", BLUE)
    card_text(c, 568, 60, 245, 112, "Optional ingestion", "JSON and simple CSV upload, validation preview, mapping and import history exist for testing or administrator-managed data preparation.", AMBER)
    new_page(c)

    # 07 workspace
    header(c, "06 | Core Workspace", "Three-column safety review cockpit", "Patient context, the AI response and clinician evaluation remain visible together to reduce context switching.", 7)
    image_cover(c, SCREENS / "desktop-workspace.png", 28, 134, 785, 341, crop=False)
    tag(c, "LIVE UI | DEEPSEEK COMPLETED", 43, 148, GREEN, white, 155)
    cols = [
        (28, 247, "A | Longitudinal context", "Patient summary, diagnoses, allergies, timeline and laboratory trends.", BLUE),
        (297, 247, "B | Virtual-doctor output", "Assessment, plan, monitoring, safety and uncertainty in a structured response.", GREEN),
        (566, 247, "C | Clinician input", "Six 1-5 scores, safety checks, issue tags and required feedback.", CRIMSON),
    ]
    for x, w, title, body, accent in cols:
        card_text(c, x, 48, w, 66, title, body, accent)
    new_page(c)

    # 08 longitudinal visualization
    header(c, "07 | Longitudinal Data", "What is implemented, and what is still missing?", "The prototype has a sound first layer; the next iteration must scale to longer and denser patient histories.", 8)
    image_cover(c, SCREENS / "desktop-workspace.png", 28, 205, 385, 270, crop=True)
    tag(c, "CURRENT IMPLEMENTATION", 43, 219, GREEN, white, 135)
    card_text(c, 438, 337, 375, 138, "Already implemented", "Patient summary; diagnoses and allergies; chronological visits; current and planned events; trend tables for HbA1c, eGFR, UACR and blood pressure; explicit simulated-data labels.", GREEN)
    card_text(c, 438, 205, 375, 112, "Main limitation", "The current design uses a compact example. It has not yet been validated for years of visits, many medications, multiple documents or high-frequency observations.", AMBER)
    features = [
        ("Filter and focus", "Date range, event type, specialty and abnormal-only views"),
        ("Change detection", "Medication starts/stops, diagnosis changes and treatment escalation"),
        ("Linked exploration", "Selecting a point on a trend highlights the associated visit and intervention"),
        ("Progressive disclosure", "Start with a clinical summary; expand only when detailed evidence is needed"),
    ]
    for i, (title, body) in enumerate(features):
        x = 28 + i * 196
        card_text(c, x, 62, 181, 110, title, body, BLUE if i % 2 == 0 else CRIMSON, number=i + 1)
    new_page(c)

    # 09 DeepSeek
    header(c, "08 | Model Integration", "What role does DeepSeek play?", "DeepSeek is the current virtual doctor being evaluated, not the automatic evaluator.", 9)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 294, 785, 160, 12, stroke=0, fill=1)
    nodes = [
        (46, "Simulated case", "clinicalData"),
        (205, "Frontend request", "POST /agent-runs"),
        (364, "Backend adapter", "versioned prompt"),
        (523, "DeepSeek API", "deepseek-v4-pro"),
        (682, "Run record", "output + metadata"),
    ]
    for i, (x, title, note) in enumerate(nodes):
        round_rect(c, x, 335, 116, 76, fill=white, stroke=HexColor("#C8D9E8"))
        para(c, title, x + 8, 392, 100, 26, size=8.2, bold=True, align=TA_CENTER)
        para(c, note, x + 8, 367, 100, 20, size=7, color=MUTED, align=TA_CENTER)
        if i < len(nodes) - 1:
            flow_arrow(c, x + 118, 373, x + 151, CRIMSON)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 10.5)
    c.drawString(28, 260, "Invocation and audit strategy")
    bullet_list(c, [
        "The frontend never stores the API key; credentials remain in ignored local environment variables or a future hosting secret.",
        "Only an explicit Agent Run sends the simulated case to the external model; initial seed data are not sent automatically.",
        "The prompt requires five fixed sections and instructs the model not to invent findings or expose hidden reasoning.",
        "Provider, model version, prompt version, response ID, usage, status and timestamps are recorded for traceability.",
    ], 28, 235, 405, size=7.7, leading=11.4, gap=4)
    round_rect(c, 465, 85, 348, 165, fill=white)
    para(c, "Currently verified", 485, 228, 150, 25, size=10.5, bold=True)
    tag(c, "DeepSeek API", 485, 190, PALE_GREEN, GREEN, 88)
    tag(c, "deepseek-v4-pro", 582, 190, PALE_BLUE, BLUE, 112)
    tag(c, "Completed", 703, 190, PALE_GREEN, GREEN, 78)
    para(c, "The full backend path has been tested with a simulated chronic-care case, and the workspace displays the five-section output. An automatic Evaluator has not been connected; clinicians remain the rating authority.", 485, 171, 308, 85, size=8.2, leading=12.5, color=MUTED)
    c.setFillColor(PALE_RED)
    c.roundRect(485, 102, 308, 35, 7, stroke=0, fill=1)
    para(c, "Research output only. Not clinical advice or patient care.", 495, 128, 288, 22, size=7.8, color=CRIMSON, bold=True, align=TA_CENTER)
    new_page(c)

    # 10 rubrics and interactive input
    header(c, "09 | Interactive Clinician Input", "How can real doctors interact with the platform?", "The current interface supports structured evaluation; patient-specific clinical querying is the next extension.", 10)
    rubrics = [
        ("01", "Accuracy", "Factual correctness of medical content"),
        ("02", "Completeness", "Coverage of the important case issues"),
        ("03", "Communication quality", "Clarity, structure and patient-centred language"),
        ("04", "Context awareness", "Appropriate use of longitudinal context"),
        ("05", "Instruction following", "Completion of the requested clinical task"),
        ("06", "Safety", "Safety prioritisation and harm prevention"),
    ]
    for i, (n, title, note) in enumerate(rubrics):
        col = i % 2
        row = i // 2
        x = 28 + col * 398
        y = 368 - row * 88
        round_rect(c, x, y, 377, 68, fill=white)
        c.setFillColor(CRIMSON if i == 5 else NAVY_2)
        c.circle(x + 29, y + 34, 17, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 8.5)
        c.drawCentredString(x + 29, y + 31, n)
        para(c, title, x + 60, y + 54, 300, 22, size=9.2, bold=True)
        para(c, note, x + 60, y + 31, 300, 25, size=7.6, color=MUTED)
    c.setFillColor(NAVY)
    c.roundRect(28, 59, 785, 112, 10, stroke=0, fill=1)
    para(c, "Next interactive layer: patient-specific query", 48, 145, 290, 25, size=10.8, bold=True, color=white)
    para(c, "Example: 'How has renal function changed after medication adjustments?' The answer should use only the selected patient's record, state uncertainty and return evidence links for every factual claim.", 48, 118, 470, 60, size=8.3, leading=12.5, color=white)
    tag(c, "ASK", 559, 111, CRIMSON, white, 50)
    tag(c, "ANSWER", 617, 111, PALE_BLUE, BLUE, 64)
    tag(c, "CITE", 689, 111, PALE_GREEN, GREEN, 52)
    tag(c, "VERIFY", 749, 111, white, NAVY, 56)
    new_page(c)

    # 11 provenance
    header(c, "10 | Evidence Traceability", "How should clinicians trace claims to original evidence?", "The current side-by-side layout supports visual comparison, but claim-level clickable provenance is not yet implemented.", 11)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 267, 785, 188, 11, stroke=0, fill=1)
    flow = [
        (48, "AI claim", "eGFR is stable at 62"),
        (235, "Citation marker", "[Lab 4] [Visit 3]"),
        (422, "Evidence drawer", "Source values + date + provenance"),
        (609, "Original record", "Lab, encounter, medication or note"),
    ]
    for i, (x, title, note) in enumerate(flow):
        round_rect(c, x, 319, 150, 82, fill=white, stroke=HexColor("#C8D9E8"))
        para(c, title, x + 10, 385, 130, 22, size=9, bold=True, align=TA_CENTER)
        para(c, note, x + 12, 360, 126, 34, size=7.2, leading=10, color=MUTED, align=TA_CENTER)
        if i < len(flow) - 1:
            flow_arrow(c, x + 153, 360, x + 181, CRIMSON)
    card_text(c, 28, 92, 245, 135, "Minimum provenance schema", "Claim ID, source type, source record ID, observation code, value, unit, timestamp, encounter and extraction version.", BLUE)
    card_text(c, 298, 92, 245, 135, "Clinician interaction", "Click a citation to open a side drawer, inspect the exact record, navigate to the timeline event and compare related measurements.", GREEN)
    card_text(c, 568, 92, 245, 135, "Evaluation benefit", "Reviewers can distinguish a medically wrong conclusion from a retrieval failure, stale data, missing context or unsupported model inference.", CRIMSON)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.4)
    c.drawCentredString(W / 2, 68, "Implementation principle: evidence is a first-class data object, not merely a number printed by the language model.")
    new_page(c)

    # 12 feedback
    header(c, "11 | Data Strategy", "Where does clinician feedback go?", "Clinical Ground Truth and product-experience feedback are persisted separately.", 12)
    c.setFillColor(PALE)
    c.roundRect(28, 240, 785, 225, 11, stroke=0, fill=1)
    card_text(c, 48, 270, 320, 165, "Assessment / Case Feedback", "<b>Purpose:</b> evaluate the medical quality of the agent response and form future Evaluator data.<br/><br/><b>Bound fields:</b> Case ID, Agent Run ID, rubric version, reviewer, six scores, safety flag, issue tags, free text and timestamp.", CRIMSON)
    card_text(c, 473, 270, 320, 165, "Platform Feedback", "<b>Purpose:</b> improve the interface and workflow; it is excluded from model-quality scoring.<br/><br/><b>Fields:</b> topic, clarity rating, comment, page, platform version, reviewer, status and timestamp. Administrators can review and export CSV.", BLUE)
    flow_arrow(c, 380, 353, 461, GREEN)
    tag(c, "SEPARATE", 389, 365, PALE_GREEN, GREEN, 64)
    image_cover(c, SCREENS / "desktop-assessments.png", 28, 55, 378, 160, crop=True)
    image_cover(c, SCREENS / "desktop-feedback-inbox.png", 435, 55, 378, 160, crop=True)
    tag(c, "ASSESSMENT HISTORY", 43, 69, NAVY, white, 125)
    tag(c, "0 RECORDS | PROFILE BARS ARE DEMO UI", 173, 69, PALE_RED, CRIMSON, 190)
    tag(c, "FEEDBACK INBOX", 450, 69, NAVY, white, 110)
    new_page(c)

    # 13 architecture
    header(c, "12 | Technical Architecture", "Architecture and interface boundaries", "The UI, versioned API, model adapter and persistence layer are isolated so they can evolve independently.", 13)
    layers = [
        ("Clinician UI", "React 19 + Vite 6", "English clinical interface | deep navy and crimson"),
        ("Versioned API", "/api/v1/*", "cases | imports | agent runs | assessments | feedback"),
        ("Model Adapter", "Mock / DeepSeek", "versioned prompt | timeout | error handling | metadata"),
        ("Persistence", "Local JSON / D1", "five entities | migrations | database-confirmed writes"),
    ]
    x = 50
    y = 370
    colors = [NAVY, BLUE, GREEN, CRIMSON]
    for i, (title, tech, note) in enumerate(layers):
        c.setFillColor(colors[i])
        c.roundRect(x, y - i * 78, 742, 58, 9, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 10.2)
        c.drawString(x + 20, y + 29 - i * 78, title)
        c.setFont(FONT_BOLD, 8.5)
        c.drawString(x + 175, y + 29 - i * 78, tech)
        c.setFont(FONT_REG, 7.6)
        c.drawString(x + 337, y + 29 - i * 78, note)
        if i < len(layers) - 1:
            c.setStrokeColor(LINE)
            c.setLineWidth(2)
            c.line(W / 2, y - 5 - i * 78, W / 2, y - 17 - i * 78)
    para(c, "Current API", 50, 131, 100, 24, size=10.5, bold=True)
    api_text = "GET /health | GET /cases | GET /cases/:id | POST /cases/import | GET /import-jobs | POST /agent-runs | GET/POST /assessments | POST /platform-feedback | GET /admin/platform-feedback"
    para(c, api_text, 50, 110, 742, 60, size=7.6, leading=12, color=MUTED)
    new_page(c)

    # 14 evidence
    header(c, "13 | Verification", "Which outcomes have actually been verified?", "The evidence below comes from the current local Git baseline and a runtime check on 13 August 2026.", 14)
    checks = [
        ("Health endpoint", "HTTP 200 | status ok", "Database: local persistent JSON | model adapter: deepseek", GREEN),
        ("Model run", "DeepSeek API | Completed", "Workspace displays a five-section deepseek-v4-pro chronic-care output", GREEN),
        ("Local data", "2 cases | 2 agent runs", "1 import job | 0 assessments | 0 platform-feedback records", BLUE),
        ("Automated tests", "4 / 4 passed", "Assets, route fallback, API isolation and Sites packaging", GREEN),
        ("Git baseline", "v0.2.0-deepseek", "main HEAD b73d762 | DeepSeek feature commit ba93d33", NAVY),
        ("Credential isolation", ".env.local ignored", "API key is absent from frontend source and Git; rotate it before formal use", AMBER),
    ]
    for i, (title, value, note, accent) in enumerate(checks):
        col = i % 2
        row = i // 2
        x = 28 + col * 398
        y = 364 - row * 105
        round_rect(c, x, y, 377, 87, fill=white)
        c.setFillColor(accent)
        c.circle(x + 31, y + 44, 17, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 8.5)
        c.drawCentredString(x + 31, y + 41, "OK")
        para(c, title, x + 62, y + 70, 130, 22, size=8.5, color=MUTED)
        para(c, value, x + 62, y + 49, 285, 24, size=10.2, bold=True)
        para(c, note, x + 62, y + 28, 295, 28, size=7, leading=10, color=MUTED)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 51, 785, 85, 10, stroke=0, fill=1)
    para(c, "Interpretation", 48, 114, 105, 22, size=10, bold=True)
    para(c, "Operational verification is not clinical validation. These checks show that the software loop and external model call work; they do not prove that DeepSeek's recommendations are correct or that the system is ready for hospital deployment.", 155, 116, 630, 52, size=8.4, leading=13, color=INK)
    new_page(c)

    # 15 safety
    header(c, "14 | Safety and Governance", "Current safety boundaries", "A rigorous medical-AI platform must state clearly what it cannot yet do.", 15)
    card_text(c, 28, 310, 247, 155, "Data boundary", "Only simulated or approved de-identified data may be used. Identifiable patient data must not be sent to this prototype or a third-party model without ethical, privacy and cross-border approvals.", CRIMSON)
    card_text(c, 297, 310, 247, 155, "Clinical boundary", "DeepSeek is a general model, not a medical device validated by this project. Its output is an object of research evaluation and must not be used for diagnosis, prescribing or patient care.", AMBER)
    card_text(c, 566, 310, 247, 155, "Identity and access boundary", "The sign-in page is demonstrative. Hospital deployment requires SSO, role-based access control, server-side authorisation and complete audit logging.", BLUE)
    c.setFillColor(NAVY)
    c.roundRect(28, 83, 785, 185, 11, stroke=0, fill=1)
    para(c, "Required before a formal pilot", 48, 243, 220, 28, size=11.5, bold=True, color=white)
    two_cols = [
        ["Data-processing agreement and residency assessment", "Input de-identification and output safety filtering", "Encryption, key rotation and least privilege", "Access logs, audit events and retention policy"],
        ["Hospital SSO and role permissions", "Model timeout, retry, error classes and asynchronous states", "Multi-reviewer design and agreement analysis", "Clinical safety validation and incident escalation"],
    ]
    for col, items in enumerate(two_cols):
        y2 = 210
        x2 = 48 + col * 380
        for item in items:
            c.setFillColor(CRIMSON)
            c.circle(x2 + 4, y2 - 5, 2.6, stroke=0, fill=1)
            para(c, item, x2 + 15, y2 + 2, 330, 24, size=8, color=white)
            y2 -= 31
    new_page(c)

    # 16 roadmap
    header(c, "15 | Roadmap", "From a P0 prototype to a trustworthy platform", "Prioritise longitudinal usability, evidence traceability, research quality and governance before expanding model coverage.", 16)
    roadmap = [
        ("P1-A", "Longitudinal UX", ["Filtering and progressive disclosure", "Abnormality and change highlighting", "Linked timeline and trend exploration"], BLUE),
        ("P1-B", "Query and provenance", ["Patient-specific clinical query interface", "Claim-level citation and evidence drawer", "Retrieval, prompt and evidence audit trail"], CRIMSON),
        ("P1-C", "Research quality", ["Versioned rubric database", "Multi-clinician blind review", "Inter-rater reliability and Ground Truth export"], GREEN),
    ]
    for i, (phase, title, items, accent) in enumerate(roadmap):
        x = 28 + i * 269
        round_rect(c, x, 205, 247, 250, fill=white)
        c.setFillColor(accent)
        c.roundRect(x, 402, 247, 53, 9, stroke=0, fill=1)
        c.rect(x, 402, 247, 20, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 8.5)
        c.drawString(x + 16, 434, phase)
        c.setFont(FONT_BOLD, 13.5)
        c.drawString(x + 16, 412, title)
        y2 = 369
        for j, item in enumerate(items, 1):
            c.setFillColor(accent)
            c.circle(x + 25, y2 - 4, 10, stroke=0, fill=1)
            c.setFillColor(white)
            c.setFont(FONT_BOLD, 7.5)
            c.drawCentredString(x + 25, y2 - 7, str(j))
            h2 = para(c, item, x + 46, y2 + 8, 180, 48, size=7.8, leading=11.2, color=INK)
            y2 -= max(52, h2 + 23)
    c.setFillColor(PALE_RED)
    c.roundRect(28, 68, 785, 105, 10, stroke=0, fill=1)
    para(c, "Central research question", 48, 148, 180, 24, size=10.5, bold=True, color=CRIMSON)
    para(c, "Can clinician ratings be made sufficiently consistent, interpretable and representative to support a trustworthy automatic Evaluator, while preserving traceability to the original patient evidence?", 48, 119, 735, 56, size=11.5, leading=18, color=INK, bold=True)
    new_page(c)

    # 17 closing
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(CRIMSON)
    c.rect(0, H - 11, W, 11, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 15)
    c.drawString(38, H - 50, "NTU")
    c.setFont(FONT_REG, 8.5)
    c.drawString(86, H - 48, "AI Safety & Evaluation")
    para(c, "A runnable, reviewable and traceable P0 loop is now in place.", 80, 395, 680, 70, size=23, leading=35, color=white, bold=True, align=TA_CENTER)
    para(c, "The next step is to make longitudinal evidence easier to navigate, add grounded clinician querying and build claim-level provenance before any formal clinical deployment.", 135, 320, 570, 95, size=12.5, leading=21, color=HexColor("#C8D7E8"), align=TA_CENTER)
    tag(c, "P0 COMPLETE", 214, 184, CRIMSON, white, 112)
    tag(c, "DEEPSEEK CONNECTED", 334, 184, PALE_GREEN, GREEN, 145)
    tag(c, "CLINICIAN GROUND TRUTH", 487, 184, white, NAVY, 172)
    c.setFillColor(HexColor("#AFC4DC"))
    c.setFont(FONT_REG, 8.2)
    c.drawCentredString(W / 2, 103, "Repository baseline: v0.2.0-deepseek | Simulated data only | Research use only")
    c.drawCentredString(W / 2, 83, "Implementation evidence, limitations and future adjustments are explicitly separated in this handbook.")
    footer(c, 17)

    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
