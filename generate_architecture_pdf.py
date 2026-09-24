# -*- coding: utf-8 -*-
"""Generates the LUMIQ-branded, shareable PDF version of the
Star Health AI Tutor architecture document."""

import os
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, ListFlowable, ListItem, PageBreak
)
from reportlab.graphics.shapes import Drawing, Rect, Line, String, Polygon
from reportlab.pdfgen import canvas as canvas_mod

SKILL_DIR = r"C:\Users\minal.bansal\.claude\skills\lumiq-brand"
LOGO_PATH = os.path.join(SKILL_DIR, "assets", "lumiq_logo.png")
OUT_PATH = r"C:\Users\minal.bansal\S2SPOC\S2S-RAG-POC\StarHealth_AITutor_Architecture.pdf"

# ---- Brand colours ----
BLUE = HexColor("#0F4761")
ORANGE = HexColor("#F36b1d")
CHARCOAL = HexColor("#352F3D")
GREY = HexColor("#808080")
LIGHT_GREY = HexColor("#F2F2F2")
BLACK = HexColor("#000000")
WHITE = HexColor("#FFFFFF")

FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_ITALIC = "Helvetica-Oblique"

PAGE_W, PAGE_H = A4
MARGIN = 1 * inch

CONFIDENTIALITY_TEXT = (
    "The information contained in the document is confidential, privileged and only for the "
    "information of the intended recipient and may not be used, published or redistributed "
    "without the prior written consent of LUMIQ. This proposal is the property of LUMIQ. No "
    "part of this document, including all concepts and ideas contained herein, may be "
    "reproduced or transmitted in any form, or by any means, electronic or mechanical, for any "
    "purpose without the express written permission of LUMIQ. Any non-consensual use, copying, "
    "republication or redistribution of contents contained in this document is expressly "
    "prohibited and are protected under applicable law."
)


def draw_cover(c: canvas_mod.Canvas):
    c.saveState()
    c.setFillColor(WHITE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    x = MARGIN
    y = PAGE_H - MARGIN - 1.5 * inch

    # 1. Customer name
    c.setFont(FONT, 22)
    c.setFillColor(BLACK)
    c.drawString(x, y, "Star Health")

    # 2. Document title
    y -= 0.8 * inch
    c.setFont(FONT_BOLD, 34)
    c.drawString(x, y, "Star Health AI Tutor")

    # 3. Sub-title (immediately below)
    y -= 0.42 * inch
    c.setFont(FONT, 16)
    c.drawString(x, y, "A Proof of Concept (POC) for voice-to-voice AI tutoring")

    # 4. Version (immediately below)
    y -= 0.28 * inch
    c.setFont(FONT, 14)
    c.setFillColor(GREY)
    c.drawString(x, y, "v1.0 \u2014 POC \u00b7 Sept 2026")

    # 5. Submitted By label
    y -= 1.5 * inch
    c.setFont(FONT_BOLD, 10)
    c.setFillColor(BLACK)
    c.drawString(x, y, "Submitted By")

    # 6. LUMIQ logo, ~50px tall, proportional width
    y -= 0.9 * inch
    logo_h = 50 * (72.0 / 96.0)  # 50px @ 96dpi -> pt
    from PIL import Image as PILImage
    with PILImage.open(LOGO_PATH) as im:
        iw, ih = im.size
    logo_w = logo_h * (iw / ih)
    c.drawImage(LOGO_PATH, x, y - logo_h, width=logo_w, height=logo_h, mask="auto")

    # 7 & 8. Confidentiality paragraph + rights line
    y -= (logo_h + 2 * inch)
    style = ParagraphStyle(
        "conf", fontName=FONT, fontSize=9, leading=12, textColor=GREY, alignment=TA_LEFT
    )
    p = Paragraph(CONFIDENTIALITY_TEXT, style)
    avail_w = PAGE_W - 2 * MARGIN
    pw, ph = p.wrap(avail_w, 3 * inch)
    p.drawOn(c, x, y - ph)
    y2 = y - ph - 12
    c.setFont(FONT, 9)
    c.setFillColor(GREY)
    c.drawString(x, y2, "All rights reserved.")

    # Cover footer
    c.setFont(FONT, 8)
    c.setFillColor(GREY)
    c.drawString(MARGIN, 0.5 * inch, "Confidential")

    c.restoreState()


def draw_running_footer(c: canvas_mod.Canvas, page_num: int, total_pages: str):
    c.saveState()
    c.setFont(FONT, 9)
    c.setFillColor(GREY)
    y = 0.5 * inch
    c.drawString(MARGIN, y, "Confidential")
    c.drawCentredString(PAGE_W / 2, y, "LUMIQ (www.lumiq.ai)")
    c.drawRightString(PAGE_W - MARGIN, y, f"Page {page_num} of {total_pages}")
    c.restoreState()


def on_first_page(c: canvas_mod.Canvas, doc):
    draw_cover(c)


def on_later_pages(c: canvas_mod.Canvas, doc):
    # Footer needs the final total page count, which isn't known until the
    # whole document is built — actual drawing happens in NumberedCanvas.save().
    pass


class NumberedCanvas(canvas_mod.Canvas):
    """Defers footer drawing until save(), once the true page count is known."""

    def __init__(self, *args, **kwargs):
        canvas_mod.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total_content_pages = len(self._saved_page_states) - 1  # exclude cover
        for state in self._saved_page_states:
            self.__dict__.update(state)
            if self._pageNumber > 1:
                draw_running_footer(self, self._pageNumber - 1, str(total_content_pages))
            canvas_mod.Canvas.showPage(self)
        canvas_mod.Canvas.save(self)


# ---------- Sequence diagram (redrawn from the HTML/SVG version) ----------
def build_diagram() -> Drawing:
    scale = 0.58
    svg_w, svg_h = 720, 460
    w, h = svg_w * scale, svg_h * scale
    d = Drawing(w, h)

    def X(x):
        return x * scale

    def Y(y):
        return h - y * scale

    def arrow(x1, y1, x2, y2, color=BLACK, width=1.1):
        d.add(Line(X(x1), Y(y1), X(x2), Y(y2), strokeColor=color, strokeWidth=width))
        # simple arrowhead pointing from (x1,y1)->(x2,y2)
        import math
        ang = math.atan2(Y(y2) - Y(y1), X(x2) - X(x1))
        size = 5
        p1 = (X(x2), Y(y2))
        p2 = (X(x2) - size * math.cos(ang - 0.4), Y(y2) - size * math.sin(ang - 0.4))
        p3 = (X(x2) - size * math.cos(ang + 0.4), Y(y2) - size * math.sin(ang + 0.4))
        d.add(Polygon(points=[p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]], fillColor=color, strokeColor=color))

    def label(x, y, text, size=7, color=BLACK, bold=False):
        d.add(String(X(x), Y(y), text, fontName=(FONT_BOLD if bold else FONT), fontSize=size, fillColor=color, textAnchor="middle"))

    # trust boundary band
    d.add(Rect(X(270), Y(430), X(490) - X(270), Y(52) - Y(430), fillColor=WHITE, strokeColor=BLUE, strokeWidth=1.2))
    label(380, 68, "TRUST BOUNDARY", size=6.5, color=BLUE, bold=True)

    # lane headers
    for lx, name in [(100, "Browser"), (380, "Backend"), (620, "OpenAI Realtime")]:
        d.add(Rect(X(lx - 80), Y(42), X(lx + 80) - X(lx - 80), Y(8) - Y(42), fillColor=None, strokeColor=BLACK, strokeWidth=0.8))
        label(lx, 28, name, size=7.5, bold=True)

    # lifelines
    for lx in (100, 380, 620):
        d.add(Line(X(lx), Y(44), X(lx), Y(432), strokeColor=GREY, strokeWidth=0.5, strokeDashArray=[2, 2]))

    steps = [
        (240, 82, 100, 90, 380, 90, "1 \u00b7 session request", BLACK),
        (500, 122, 380, 132, 620, 132, "2 \u00b7 mint token \u2014 real API key used here", BLUE),
        (240, 164, 380, 174, 100, 174, "3 \u00b7 ephemeral token", BLACK),
        (360, 206, 100, 218, 620, 218, "4 \u00b7 WebRTC audio \u2014 direct", BLACK),
        (360, 248, 620, 258, 100, 258, "5 \u00b7 tool call: search_policy(question)", BLACK),
        (240, 290, 100, 300, 380, 300, "6 \u00b7 question", BLACK),
        (240, 332, 380, 342, 100, 342, "7 \u00b7 evidence, or \u201cinsufficient\u201d", BLACK),
        (360, 390, 100, 400, 620, 400, "8 \u00b7 function_call_output", BLACK),
        (360, 422, 620, 428, 100, 428, "9 \u00b7 spoken answer, grounded in evidence", BLACK),
    ]
    for lbl_x, lbl_y, x1, y1, x2, y2, text, color in steps:
        label(lbl_x, lbl_y, text, size=6.6, color=color, bold=(color == BLUE))
        arrow(x1, y1, x2, y2, color=(BLUE if color == BLUE else BLACK), width=(1.6 if color == BLUE else 1.0))

    return d


def build_story():
    styles = {
        "h1": ParagraphStyle("h1", fontName=FONT, fontSize=20, leading=24, textColor=BLACK, spaceAfter=4),
        "h2grey": ParagraphStyle("h2grey", fontName=FONT_BOLD, fontSize=14, leading=18, textColor=GREY, spaceAfter=8),
        "body": ParagraphStyle("body", fontName=FONT, fontSize=11, leading=16, textColor=BLACK, spaceAfter=8),
        "lede": ParagraphStyle("lede", fontName=FONT, fontSize=12, leading=17, textColor=BLACK, spaceAfter=8),
        "caption": ParagraphStyle("caption", fontName=FONT_ITALIC, fontSize=9, leading=13, textColor=GREY, spaceAfter=8),
        "bullet": ParagraphStyle("bullet", fontName=FONT, fontSize=11, leading=15, textColor=BLACK),
        "bullethead": ParagraphStyle("bullethead", fontName=FONT_BOLD, fontSize=11, leading=15, textColor=BLACK),
    }

    content_w = PAGE_W - 2 * MARGIN
    story = [PageBreak()]

    def h1(text):
        story.append(Paragraph(text, styles["h1"]))
        story.append(Spacer(1, 6))
        # Full content-width hairline rule, matching the house convention
        # (0.72pt, margin-to-margin) confirmed from a real LUMIQ reference doc.
        rule = Table([[""]], colWidths=[content_w], rowHeights=[0.75])
        rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ORANGE)]))
        story.append(rule)
        story.append(Spacer(1, 12))

    # Goal
    h1("Goal")
    story.append(Paragraph(
        "A browser app where one speech-to-speech model explains a single health-insurance "
        "policy document out loud, lets the user interrupt at any point with a question, and "
        "answers every policy question strictly from that document \u2014 never from general "
        "knowledge, and never a guess.",
        styles["lede"],
    ))
    story.append(Spacer(1, 18))

    # Functional Architecture
    h1("Functional Architecture")
    story.append(build_diagram())
    story.append(Paragraph(
        "The real API key (blue boundary) never leaves the backend. Audio runs straight between "
        "browser and model for low latency (step 4); every policy question is forced through the "
        "tool round-trip (steps 5\u20139) so the model can only answer from retrieved evidence.",
        styles["caption"],
    ))
    story.append(Spacer(1, 18))

    # Design Principles
    h1("Design Principles")
    principles = [
        ("One realtime model, no pipeline stitching.", "Speech-to-text, reasoning, text-to-speech, and interruption handling are one model over one WebRTC connection \u2014 not three services glued together."),
        ("Evidence before answer.", "The system prompt forces a search_policy tool call for any policy-specific question; the model is never allowed to answer from general insurance knowledge."),
        ("A fixed refusal, not a guess.", "When retrieval confidence falls below threshold, the model returns one exact sentence \u2014 never an improvised, possibly wrong, answer."),
        ("Credentials and data stay server-side.", "The browser only ever holds a short-lived session token and plain evidence text \u2014 never the API key, never the vector index."),
        ("The retriever is swappable.", "One interface, PolicyRetriever.search(question), isolates today's local JSON store from tomorrow's hosted vector search \u2014 nothing else in the system needs to change."),
    ]
    items = []
    for head, body in principles:
        items.append(ListItem(Paragraph(f"<b>{head}</b> {body}", styles["bullet"]), bulletColor=ORANGE))
    story.append(ListFlowable(items, bulletType="bullet", bulletFontSize=8, leftIndent=16, spaceBefore=2, bulletOffsetY=-2))
    story.append(Spacer(1, 18))

    # Solution Approach
    h1("Solution Approach")
    data = [
        ["Concern", "Choice", "Why"],
        ["Voice model", "OpenAI Realtime API (gpt-realtime) over WebRTC",
         "Single model covers STT, reasoning, TTS, and barge-in \u2014 no LiveKit, no Pipecat, no "
         "multi-agent orchestration. Preferred over Gemini Live API because it connects "
         "browser-to-model over native WebRTC, versus Gemini's WebSocket transport, which needs "
         "a hand-built raw-PCM audio pipeline in the browser."],
        ["Auth", "Backend mints a short-lived ephemeral token per session",
         "The real API key is used exactly once per session, server-side, and never reaches the browser."],
        ["Tool execution", "Browser relays the tool call; backend does the retrieval",
         "This is how Realtime function-calling works \u2014 but the vector index and embeddings never leave the backend."],
        ["RAG store", "Local JSON file, brute-force cosine similarity",
         "Simplest reliable option for one policy document at POC scale \u2014 no database server, no ops."],
        ["Ingestion", "One-off script: PDF -> chunks -> embeddings -> index",
         "Runs once at setup; keeps the runtime path free of PDF parsing."],
    ]
    cell_style = ParagraphStyle("cell", fontName=FONT, fontSize=9.5, leading=13, textColor=BLACK)
    header_style = ParagraphStyle("cellh", fontName=FONT_BOLD, fontSize=10, leading=13, textColor=WHITE)
    concern_style = ParagraphStyle("cellc", fontName=FONT_BOLD, fontSize=9.5, leading=13, textColor=BLACK)

    table_data = [[Paragraph(c, header_style) for c in data[0]]]
    for row in data[1:]:
        table_data.append([
            Paragraph(row[0], concern_style),
            Paragraph(row[1], cell_style),
            Paragraph(row[2], cell_style),
        ])

    col_widths = [content_w * 0.16, content_w * 0.32, content_w * 0.52]
    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.5, GREY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 18))

    # Security & Guardrails
    h1("Security &amp; Guardrails")
    sec_items = [
        "Browser holds only an ephemeral Realtime token \u2014 never the actual API key.",
        "Every policy question is forced through search_policy; the model cannot see or query the vector store directly.",
        "Answers are constrained to retrieved evidence by the system prompt, with one fixed fallback sentence when evidence is insufficient.",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(t, styles["bullet"]), bulletColor=BLACK) for t in sec_items],
        bulletType="bullet", bulletFontSize=8, leftIndent=16,
    ))

    return story


def main():
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
        title="Star Health AI Tutor",
    )
    story = build_story()
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages, canvasmaker=NumberedCanvas)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
