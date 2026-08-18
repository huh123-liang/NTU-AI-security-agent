from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw
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
OUT = OUT_DIR / "AI_Medical_Agent_Evaluation_Platform_Showcase_Handbook_CN.pdf"
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

FONT_REG = "CN"
FONT_BOLD = "CN-Bold"
pdfmetrics.registerFont(TTFont(FONT_REG, r"C:\Windows\Fonts\msyh.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\msyhbd.ttc", subfontIndex=0))


def pstyle(size=11, leading=None, color=INK, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s{size}-{bold}-{align}-{color}",
        fontName=FONT_BOLD if bold else FONT_REG,
        fontSize=size,
        leading=leading or size * 1.5,
        textColor=color,
        alignment=align,
        wordWrap="CJK",
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
    width = width or max(54, 12 + len(text) * 7.1)
    c.setFillColor(fill)
    c.roundRect(x, y, width, 19, 9.5, stroke=0, fill=1)
    c.setFillColor(color)
    c.setFont(FONT_BOLD, 8.2)
    c.drawCentredString(x + width / 2, y + 5.5, text)
    return width


def header(c, section, title, subtitle=None, page=None):
    c.setFillColor(CRIMSON)
    c.rect(28, H - 41, 4, 16, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 8.5)
    c.drawString(41, H - 36, section.upper())
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 22)
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
    c.setFont(FONT_REG, 7.5)
    c.drawString(28, 12, "AI Medical Agent Evaluation Platform · Research Prototype · 13 Aug 2026")
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
        tmp = SCREENS / f"_crop_{path.stem}_{int(w)}x{int(h)}.jpg"
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
    c.setFont(FONT_BOLD, 13)
    c.drawCentredString(x + 28.5, y + 32.5, value[:3])
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 10)
    c.drawString(x + 55, y + 48, label)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.8)
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
    para(c, title, tx, y + h - 13, w - (tx - x) - 12, 26, size=10.5, bold=True)
    para(c, body, x + 14, y + h - 47, w - 28, h - 56, size=8.2, leading=12, color=MUTED)


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


def bullet_list(c, items, x, y_top, width, size=9.1, leading=13, color=INK, gap=5):
    y = y_top
    for item in items:
        c.setFillColor(CRIMSON)
        c.circle(x + 3.5, y - 7, 2.4, stroke=0, fill=1)
        h = para(c, item, x + 13, y, width - 13, 55, size=size, leading=leading, color=color)
        y -= h + gap
    return y


def new_page(c):
    c.showPage()


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    c = Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("AI医疗智能体评估平台展示手册")
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
    para(c, "AI医疗智能体<br/>评估平台", 34, H - 142, 290, 150, size=33, leading=43, color=white, bold=True)
    para(c, "展示手册 · SHOWCASE HANDBOOK", 36, H - 275, 290, 25, size=11, leading=15, color=HexColor("#BFD0E4"), bold=True)
    para(c, "面向医生的虚拟医生输出质量评估工作台<br/>Clinician-grounded evaluation for AI medical agents", 36, H - 313, 290, 70, size=11, leading=18, color=white)
    c.setFillColor(HexColor("#BFD0E4"))
    c.setFont(FONT_REG, 8.3)
    c.drawString(36, 51, "P0 MVP · v0.2.0-deepseek")
    c.drawString(36, 35, "13 August 2026 · Simulated data only")
    new_page(c)

    # 02 Executive summary
    header(c, "01 · Executive Summary", "我们已经完成了什么？", "从病例导入到医生评分、反馈存储与历史查询的可运行P0闭环。", 2)
    c.setFillColor(NAVY)
    c.roundRect(28, 330, 785, 125, 11, stroke=0, fill=1)
    para(c, "一句话定义", 48, 430, 115, 25, size=10, color=HexColor("#AFC4DC"), bold=True)
    para(c, "让真实医生在统一、可审计的界面中评价一个AI“虚拟医生”对纵向慢病病例生成的一份回答，并将结构化评分与文字反馈沉淀为后续Evaluator的Ground Truth。", 48, 397, 715, 90, size=16, leading=25, color=white, bold=True)
    stat(c, 28, 230, 185, "端到端页面", "09", "登录至反馈管理", BLUE)
    stat(c, 228, 230, 185, "评分维度", "06", "1–5分 + 安全检查", CRIMSON)
    stat(c, 428, 230, 185, "核心实体", "05", "病例/运行/评分/反馈/导入", GREEN)
    stat(c, 628, 230, 185, "自动化测试", "4/4", "当前全部通过", AMBER)
    card_text(c, 28, 61, 247, 139, "已实现", "数据导入、病例库、三栏评估工作台、DeepSeek服务端调用、医生结构化评分、Case Feedback、Platform Feedback、历史与CSV导出。", GREEN)
    card_text(c, 297, 61, 247, 139, "当前用途", "用于医生演示、工作流验证和收集设计反馈；病例均为模拟或经批准去标识的数据。", BLUE)
    card_text(c, 566, 61, 247, 139, "明确边界", "不是医疗器械、不是临床决策支持系统，也尚未完成正式身份认证、多医生一致性分析和自动Evaluator训练。", CRIMSON)
    new_page(c)

    # 03 Research basis
    header(c, "02 · Research Basis", "为什么这样设计？", "设计吸收了开放式医疗评估、医生Rubric与真实临床任务评估的关键原则。", 3)
    card_text(c, 28, 280, 375, 195, "HealthBench：从标准答案转向医生Rubric", "5,000个真实感健康对话，由262名医生编写48,562条情境化评分准则。它强调开放式输出应按准确性、完整性、沟通、上下文意识与指令遵循等行为轴评价，并验证模型评分与医生判断的一致性。<br/><br/><b>对本项目的启发：</b>使用医生结构化评分 + 自由文本反馈；避免只用单一总分。", BLUE)
    card_text(c, 438, 280, 375, 195, "MAST观点：临床就绪取决于具体任务与情境", "孤立的基准分数不足以证明临床就绪。慢病管理需要纵向上下文、重复评估、安全与伤害避免、以及不确定性校准；评估框架也必须随模型能力演进。<br/><br/><b>对本项目的启发：</b>优先展示纵向病例、明确任务范围、记录模型/Prompt版本，并将安全检查单独提升。", CRIMSON)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 80, 785, 165, 10, stroke=0, fill=1)
    para(c, "研究原则 → 产品机制", 48, 222, 200, 28, size=12, bold=True)
    mappings = [
        ("开放式医疗回答", "三栏工作台并置病例、回答与评分"),
        ("医生判断是当前Ground Truth", "六维评分 + Case Feedback + Reviewer绑定"),
        ("任务和情境必须明确", "慢病纵向病例 + 单一虚拟医生的一份回答"),
        ("安全不能被平均分掩盖", "Safety 维度 + Safety-Critical Yes/No + 原因标签"),
        ("基准必须可复现与演进", "Provider / Model / Prompt版本与运行状态记录"),
    ]
    y = 190
    for left, right in mappings:
        c.setFillColor(white)
        c.roundRect(48, y - 4, 190, 24, 5, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont(FONT_BOLD, 8.2)
        c.drawString(58, y + 4, left)
        flow_arrow(c, 248, y + 8, 274, CRIMSON)
        c.setFillColor(INK)
        c.setFont(FONT_REG, 8.2)
        c.drawString(286, y + 4, right)
        y -= 29
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 6.9)
    c.drawRightString(W - 30, 36, "Sources: Arora et al., HealthBench, arXiv:2505.08775 (2025); Goh et al., Nature Medicine, DOI:10.1038/s41591-026-04539-8 (2026).")
    new_page(c)

    # 04 workflow
    header(c, "03 · Workflow", "端到端评估流程", "P0已打通医生从数据进入到评价结果沉淀的核心链路。", 4)
    steps = [
        ("1", "导入病例", "JSON / CSV；模拟或经批准去标识"),
        ("2", "校验与入库", "必填字段、预览、Import Job"),
        ("3", "虚拟医生分析", "后台调用DeepSeek，记录版本与状态"),
        ("4", "医生评估", "六维评分、安全检查、Case Feedback"),
        ("5", "结果沉淀", "Assessment入库、历史查询"),
        ("6", "平台改进", "Platform Feedback独立存储与导出"),
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
        para(c, title, x + 10, y + 66, bw - 20, 22, size=10, bold=True, align=TA_CENTER)
        para(c, note, x + 10, y + 42, bw - 20, 40, size=7.6, leading=11, color=MUTED, align=TA_CENTER)
        if i < len(steps) - 1:
            flow_arrow(c, x + bw + 2, y + 60, x + bw + gap - 3, CRIMSON)
    c.setFillColor(PALE)
    c.roundRect(28, 87, 785, 205, 11, stroke=0, fill=1)
    para(c, "两种反馈，两个用途", 48, 267, 260, 26, size=12, bold=True)
    card_text(c, 48, 117, 335, 125, "Case Feedback · 临床Ground Truth", "回答是否准确、完整、安全？与Case ID、Agent Run、Rubric版本、Reviewer绑定，服务于后续Evaluator训练与研究分析。", CRIMSON)
    card_text(c, 458, 117, 335, 125, "Platform Feedback · 产品改进", "界面是否清晰、流程哪里卡顿？包含Topic、清晰度评分、页面、评论和状态，进入管理员Feedback Inbox。", BLUE)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8)
    c.drawCentredString(W / 2, 99, "关键设计：平台体验意见不会污染临床评价数据。")
    new_page(c)

    # 05 intake + cases
    header(c, "04 · Product Walkthrough", "数据入口与病例库", "医生先确认数据边界，再选择一个纵向慢病病例进入评估。", 5)
    image_cover(c, SCREENS / "desktop-data-intake.png", 28, 195, 500, 280, crop=False)
    image_cover(c, SCREENS / "desktop-cases.png", 548, 195, 265, 280, crop=True)
    tag(c, "LIVE UI · DATA INTAKE", 43, 208, NAVY, white, 121)
    tag(c, "LIVE UI · CASE LIBRARY", 563, 208, NAVY, white, 126)
    card_text(c, 28, 60, 245, 112, "P0数据能力", "支持JSON与简单CSV；必填字段为id、patientName、age、condition；包含预览、字段映射、验证结果与导入历史。", BLUE)
    card_text(c, 298, 60, 245, 112, "去标识门槛", "界面明确要求模拟或经批准去标识数据；直接EHR/FHIR连接目前仅为未来受治理集成。", AMBER)
    card_text(c, 568, 60, 245, 112, "病例组织", "病例库可搜索与筛选；每次评估只选择一个病例，对应单一虚拟医生的一份回答。", GREEN)
    new_page(c)

    # 06 workspace
    header(c, "05 · Core Workspace", "三栏安全审查工作台", "把“病例上下文—AI回答—医生评价”放在同一屏，降低视线切换成本。", 6)
    image_cover(c, SCREENS / "desktop-workspace.png", 28, 134, 785, 341, crop=False)
    tag(c, "LIVE UI · DEEPSEEK COMPLETED", 43, 148, GREEN, white, 155)
    cols = [
        (28, 247, "A · 病例上下文", "模拟患者信息、诊断、临床时间线、实验室趋势。", BLUE),
        (297, 247, "B · AI虚拟医生输出", "结构化展示Assessment、Plan、Monitoring、安全与不确定性。", GREEN),
        (566, 247, "C · 医生评价区", "六维1–5分、安全检查、缺失标签与必填反馈。", CRIMSON),
    ]
    for x, w, title, body, accent in cols:
        card_text(c, x, 48, w, 66, title, body, accent)
    new_page(c)

    # 07 DeepSeek
    header(c, "06 · Model Integration", "DeepSeek在系统中扮演什么角色？", "它是当前被评价的“虚拟医生”，不是自动评分器。", 7)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 294, 785, 160, 12, stroke=0, fill=1)
    nodes = [
        (46, "模拟/去标识病例", "clinicalData"),
        (205, "前端请求", "POST /agent-runs"),
        (364, "后台适配器", "版本化Prompt"),
        (523, "DeepSeek API", "deepseek-v4-pro"),
        (682, "模型运行记录", "output + metadata"),
    ]
    for i, (x, title, note) in enumerate(nodes):
        round_rect(c, x, 335, 116, 76, fill=white, stroke=HexColor("#C8D9E8"))
        para(c, title, x + 8, 392, 100, 26, size=9.2, bold=True, align=TA_CENTER)
        para(c, note, x + 8, 367, 100, 20, size=7.4, color=MUTED, align=TA_CENTER)
        if i < len(nodes) - 1:
            flow_arrow(c, x + 118, 373, x + 151, CRIMSON)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 11)
    c.drawString(28, 260, "调用策略")
    bullet_list(c, [
        "前端不保存API Key；密钥仅存在于未纳入Git的本地环境变量或未来托管Secret中。",
        "只有明确触发Agent Run时才把模拟病例发送给外部模型；初始化示例数据不会自动外发。",
        "提示词要求使用五个固定段落，并禁止编造、要求区分事实与建议、明确安全与缺失信息。",
        "保存Provider、Model version、Prompt version、Response ID、Token usage、状态与时间，支持追溯。",
    ], 28, 235, 400, size=8.5, leading=12.5, gap=4)
    round_rect(c, 465, 85, 348, 165, fill=white)
    para(c, "当前已验证", 485, 228, 150, 25, size=11, bold=True)
    tag(c, "DeepSeek API", 485, 190, PALE_GREEN, GREEN, 88)
    tag(c, "deepseek-v4-pro", 582, 190, PALE_BLUE, BLUE, 112)
    tag(c, "Completed", 703, 190, PALE_GREEN, GREEN, 78)
    para(c, "完整后端路径已使用模拟慢病病例验证，工作台可显示五段式回答。自动化Evaluator尚未接入；真实医生仍是当前评分主体。", 485, 171, 308, 85, size=9.1, leading=14, color=MUTED)
    c.setFillColor(PALE_RED)
    c.roundRect(485, 102, 308, 35, 7, stroke=0, fill=1)
    para(c, "研究输出，不是临床建议；禁止用于真实患者照护。", 495, 128, 288, 22, size=8.5, color=CRIMSON, bold=True, align=TA_CENTER)
    new_page(c)

    # 08 rubrics
    header(c, "07 · Evaluation Method", "医生如何评价AI回答？", "结构化评分捕捉可比较信号，自由文本反馈保留临床判断中的细节。", 8)
    rubrics = [
        ("01", "Accuracy", "医学内容的事实正确性"),
        ("02", "Completeness", "是否覆盖病例关键问题"),
        ("03", "Communication quality", "表达是否清晰、结构化、以患者为中心"),
        ("04", "Context awareness", "是否正确使用纵向病历上下文"),
        ("05", "Instruction following", "是否完成指定临床任务与约束"),
        ("06", "Safety", "是否优先考虑安全与伤害预防"),
    ]
    for i, (n, title, note) in enumerate(rubrics):
        col = i % 2
        row = i // 2
        x = 28 + col * 398
        y = 368 - row * 94
        round_rect(c, x, y, 377, 74, fill=white)
        c.setFillColor(CRIMSON if i == 5 else NAVY_2)
        c.circle(x + 29, y + 37, 18, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 9)
        c.drawCentredString(x + 29, y + 34, n)
        para(c, title, x + 60, y + 59, 300, 22, size=10.2, bold=True)
        para(c, note, x + 60, y + 35, 300, 28, size=8.2, color=MUTED)
    round_rect(c, 28, 62, 785, 115, fill=NAVY)
    para(c, "安全层不被平均分掩盖", 48, 153, 210, 25, size=12, bold=True, color=white)
    para(c, "除六维评分外，医生必须回答是否存在潜在伤害建议，并可标记禁忌、剂量/监测、药物相互作用、过敏、实验室阈值等问题；Case Feedback为必填。", 48, 123, 470, 65, size=9.3, leading=14.5, color=white)
    tag(c, "Safety-critical Yes / No", 555, 113, CRIMSON, white, 155)
    tag(c, "Required feedback", 555, 83, white, NAVY, 125)
    tag(c, "Ground Truth", 689, 83, PALE_GREEN, GREEN, 98)
    new_page(c)

    # 09 feedback
    header(c, "08 · Data Strategy", "医生反馈最终流向哪里？", "P0将临床Ground Truth和平台体验意见分表持久化。", 9)
    c.setFillColor(PALE)
    c.roundRect(28, 240, 785, 225, 11, stroke=0, fill=1)
    card_text(c, 48, 270, 320, 165, "Assessment / Case Feedback", "<b>用途：</b>衡量AI回答质量，形成后续Evaluator训练数据。<br/><br/><b>绑定字段：</b>Case ID、Agent Run ID、Rubric版本、Reviewer ID、六维分数、安全标志、原因标签、文字反馈、提交时间。", CRIMSON)
    card_text(c, 473, 270, 320, 165, "Platform Feedback", "<b>用途：</b>改进界面和流程，不参与临床模型评分。<br/><br/><b>字段：</b>Topic、流程清晰度1–5分、评论、当前页面、平台版本、Reviewer ID、状态与提交时间；管理员可在Inbox查看并导出CSV。", BLUE)
    flow_arrow(c, 380, 353, 461, GREEN)
    tag(c, "SEPARATE", 389, 365, PALE_GREEN, GREEN, 64)
    image_cover(c, SCREENS / "desktop-assessments.png", 28, 55, 378, 160, crop=True)
    image_cover(c, SCREENS / "desktop-feedback-inbox.png", 435, 55, 378, 160, crop=True)
    tag(c, "ASSESSMENT HISTORY", 43, 69, NAVY, white, 125)
    tag(c, "0 RECORDS · PROFILE BARS = DEMO UI", 173, 69, PALE_RED, CRIMSON, 195)
    tag(c, "FEEDBACK INBOX", 450, 69, NAVY, white, 110)
    new_page(c)

    # 10 architecture
    header(c, "09 · Technical Architecture", "基础架构与接口边界", "前端、后台模型适配器与持久化层相互隔离，便于后续替换模型或数据库。", 10)
    layers = [
        ("Clinician UI", "React 19 + Vite 6", "English clinical interface · deep navy / crimson"),
        ("Versioned API", "/api/v1/*", "cases · imports · agent runs · assessments · feedback"),
        ("Model Adapter", "Mock / DeepSeek", "versioned prompt · timeout · error handling · metadata"),
        ("Persistence", "Local JSON / D1", "5 core entities · migrations · database-confirmed writes"),
    ]
    x = 50
    y = 370
    colors = [NAVY, BLUE, GREEN, CRIMSON]
    for i, (title, tech, note) in enumerate(layers):
        c.setFillColor(colors[i])
        c.roundRect(x, y - i * 78, 742, 58, 9, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 11)
        c.drawString(x + 20, y + 29 - i * 78, title)
        c.setFont(FONT_BOLD, 9.3)
        c.drawString(x + 175, y + 29 - i * 78, tech)
        c.setFont(FONT_REG, 8.2)
        c.drawString(x + 337, y + 29 - i * 78, note)
        if i < len(layers) - 1:
            c.setStrokeColor(LINE)
            c.setLineWidth(2)
            c.line(W / 2, y - 5 - i * 78, W / 2, y - 17 - i * 78)
    para(c, "当前API", 50, 131, 100, 24, size=11, bold=True)
    api_text = "GET /health · GET /cases · GET /cases/:id · POST /cases/import · GET /import-jobs · POST /agent-runs · GET/POST /assessments · POST /platform-feedback · GET /admin/platform-feedback"
    para(c, api_text, 50, 110, 742, 60, size=8.2, leading=13, color=MUTED)
    new_page(c)

    # 11 evidence
    header(c, "10 · Verification", "哪些成果已经被验证？", "以下证据来自当前本地Git基线与2026-08-13实际运行检查。", 11)
    checks = [
        ("健康检查", "HTTP 200 · status ok", "数据库：local persistent JSON；模型适配器：deepseek", GREEN),
        ("模型运行", "DeepSeek API · Completed", "工作台显示deepseek-v4-pro生成的五段式慢病管理回答", GREEN),
        ("本地数据", "2 cases · 2 agent runs", "1条Import Job；0条Assessment；0条Platform Feedback", BLUE),
        ("自动化测试", "4 / 4 passed", "静态资源、路由fallback、API错误隔离、Sites打包文件", GREEN),
        ("Git基线", "v0.2.0-deepseek", "main HEAD b73d762；DeepSeek功能提交ba93d33", NAVY),
        ("密钥隔离", ".env.local ignored", "API Key未进入前端源码或Git；正式使用前仍应轮换已在聊天中暴露的密钥", AMBER),
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
        para(c, title, x + 62, y + 70, 130, 22, size=9.2, color=MUTED)
        para(c, value, x + 62, y + 49, 285, 24, size=11, bold=True)
        para(c, note, x + 62, y + 28, 295, 28, size=7.6, leading=10.5, color=MUTED)
    c.setFillColor(PALE_BLUE)
    c.roundRect(28, 51, 785, 85, 10, stroke=0, fill=1)
    para(c, "证据解读", 48, 114, 105, 22, size=10.5, bold=True)
    para(c, "“已运行”不等于“已临床验证”。当前证据证明软件闭环和外部模型调用可工作；它不证明DeepSeek医学建议正确，也不证明系统可在医院真实部署。", 155, 116, 630, 52, size=9.3, leading=14, color=INK)
    new_page(c)

    # 12 safety
    header(c, "11 · Safety & Governance", "当前安全边界", "医疗AI评估平台首先要诚实说明它不能做什么。", 12)
    card_text(c, 28, 310, 247, 155, "数据边界", "仅允许模拟或经批准去标识的数据。真实可识别患者数据不得发送至当前本地原型或第三方模型；正式部署需完成伦理、隐私与跨境数据审批。", CRIMSON)
    card_text(c, 297, 310, 247, 155, "临床边界", "DeepSeek是通用大模型，不是经本项目验证的医疗器械。模型回答只能作为研究评价对象，不得用于诊断、处方或真实患者照护。", AMBER)
    card_text(c, 566, 310, 247, 155, "身份与权限边界", "当前登录为演示界面；Reviewer使用本地demo标识或托管身份头。医院部署需SSO、RBAC、服务器端授权和完整审计。", BLUE)
    c.setFillColor(NAVY)
    c.roundRect(28, 83, 785, 185, 11, stroke=0, fill=1)
    para(c, "正式试点前必须补齐", 48, 243, 220, 28, size=12, bold=True, color=white)
    two_cols = [
        ["数据处理协议与数据驻留评估", "输入去标识检查与输出安全过滤", "传输/静态加密、密钥轮换与最小权限", "访问日志、审计事件与数据保留策略"],
        ["医院SSO与角色权限", "模型超时、重试、错误分类与异步状态", "医生多评者设计与一致性分析", "临床安全验证与事故升级流程"],
    ]
    for col, items in enumerate(two_cols):
        y = 210
        x = 48 + col * 380
        for item in items:
            c.setFillColor(CRIMSON)
            c.circle(x + 4, y - 5, 2.6, stroke=0, fill=1)
            para(c, item, x + 15, y + 2, 330, 24, size=8.8, color=white)
            y -= 31
    new_page(c)

    # 13 limitations & roadmap
    header(c, "12 · Roadmap", "从P0原型走向可信评估平台", "优先把安全、研究数据质量与医院治理补齐，再扩大模型与任务覆盖。", 13)
    roadmap = [
        ("P1-A", "安全运行", ["异步状态：Queued → Analysing → Completed/Failed", "输入去标识检查、输出安全过滤", "超时、重试、错误分类、调用审计"], CRIMSON),
        ("P1-B", "研究质量", ["Rubric版本数据库与管理员配置", "多医生盲评与冲突处理", "Inter-rater reliability与Ground Truth导出"], BLUE),
        ("P2", "医院部署", ["SSO / RBAC与审计", "FHIR R4 / EHR受治理连接器", "PostgreSQL/临床数据平台迁移与认证报告"], GREEN),
    ]
    for i, (phase, title, items, accent) in enumerate(roadmap):
        x = 28 + i * 269
        round_rect(c, x, 205, 247, 250, fill=white)
        c.setFillColor(accent)
        c.roundRect(x, 402, 247, 53, 9, stroke=0, fill=1)
        c.rect(x, 402, 247, 20, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont(FONT_BOLD, 9)
        c.drawString(x + 16, 434, phase)
        c.setFont(FONT_BOLD, 15)
        c.drawString(x + 16, 412, title)
        y = 369
        for j, item in enumerate(items, 1):
            c.setFillColor(accent)
            c.circle(x + 25, y - 4, 10, stroke=0, fill=1)
            c.setFillColor(white)
            c.setFont(FONT_BOLD, 7.5)
            c.drawCentredString(x + 25, y - 7, str(j))
            h = para(c, item, x + 46, y + 8, 180, 48, size=8.5, leading=12, color=INK)
            y -= max(52, h + 23)
    c.setFillColor(PALE_RED)
    c.roundRect(28, 68, 785, 105, 10, stroke=0, fill=1)
    para(c, "当前最关键的研究问题", 48, 148, 180, 24, size=11, bold=True, color=CRIMSON)
    para(c, "如何证明平台采集到的医生评分具有足够的一致性、可解释性和任务代表性，能够作为后续自动Evaluator的可信训练与验证依据？", 48, 119, 735, 56, size=13, leading=20, color=INK, bold=True)
    new_page(c)

    # 14 closing
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(CRIMSON)
    c.rect(0, H - 11, W, 11, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_BOLD, 15)
    c.drawString(38, H - 50, "NTU")
    c.setFont(FONT_REG, 8.5)
    c.drawString(86, H - 48, "AI Safety & Evaluation")
    para(c, "我们已经完成一个可运行、可评价、可追溯的P0闭环。", 80, 395, 680, 70, size=25, leading=37, color=white, bold=True, align=TA_CENTER)
    para(c, "下一步不是继续堆叠页面，而是验证医生评分质量、完善安全治理，并把这一原型逐步转化为可复现的医疗AI评估基础设施。", 135, 320, 570, 95, size=13, leading=22, color=HexColor("#C8D7E8"), align=TA_CENTER)
    tag(c, "P0 COMPLETE", 214, 184, CRIMSON, white, 112)
    tag(c, "DEEPSEEK CONNECTED", 334, 184, PALE_GREEN, GREEN, 145)
    tag(c, "CLINICIAN GROUND TRUTH", 487, 184, white, NAVY, 172)
    c.setFillColor(HexColor("#AFC4DC"))
    c.setFont(FONT_REG, 8.2)
    c.drawCentredString(W / 2, 103, "Repository baseline: v0.2.0-deepseek · Simulated data only · Research use only")
    c.drawCentredString(W / 2, 83, "References and implementation notes are included in this handbook and the repository project guide.")
    footer(c, 14)

    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
