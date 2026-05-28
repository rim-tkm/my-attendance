import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PageSizes, PDFFont, PDFPage, rgb } from "pdf-lib";

import type { InvoicePdfModel } from "@/lib/invoice-html";

/** Noto Sans JP（Regular / Bold）Subset OTF — notofonts/noto-cjk（字形欠けが起きにくい静的ウェイト） */
const NOTO_JP_REGULAR_OTF =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf";
const NOTO_JP_BOLD_OTF =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf";

const JP_FONT_EMBED_OPTIONS = { subset: false as const };

let jpRegularBytesPromise: Promise<Uint8Array> | null = null;
let jpBoldBytesPromise: Promise<Uint8Array> | null = null;

async function fetchFontBytes(urls: string[]): Promise<Uint8Array> {
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("フォントを取得できませんでした");
}

async function loadJpRegularFontBytes(): Promise<Uint8Array> {
  if (!jpRegularBytesPromise) {
    jpRegularBytesPromise = (async () => {
      try {
        const local = await fetch("/fonts/NotoSansJP-Regular.otf");
        if (local.ok) return new Uint8Array(await local.arrayBuffer());
      } catch {
        /* fall through */
      }
      try {
        const localTtf = await fetch("/fonts/NotoSansJP-Regular.ttf");
        if (localTtf.ok) return new Uint8Array(await localTtf.arrayBuffer());
      } catch {
        /* fall through */
      }
      return fetchFontBytes([NOTO_JP_REGULAR_OTF]);
    })();
  }
  return jpRegularBytesPromise;
}

async function loadJpBoldFontBytes(): Promise<Uint8Array> {
  if (!jpBoldBytesPromise) {
    jpBoldBytesPromise = (async () => {
      try {
        const local = await fetch("/fonts/NotoSansJP-Bold.otf");
        if (local.ok) return new Uint8Array(await local.arrayBuffer());
      } catch {
        /* fall through */
      }
      try {
        const localTtf = await fetch("/fonts/NotoSansJP-Bold.ttf");
        if (localTtf.ok) return new Uint8Array(await localTtf.arrayBuffer());
      } catch {
        /* fall through */
      }
      return fetchFontBytes([NOTO_JP_BOLD_OTF]);
    })();
  }
  return jpBoldBytesPromise;
}

/** 請求・実績 PDF 共通：Regular と Bold を別 PDFFont として保持（描画直前にどちらかを明示） */
export type JpPdfFonts = { regular: PDFFont; bold: PDFFont };

/** 一括 ZIP 前など：フォント取得を完了させてから PDF 生成する */
export async function preloadJpFontsForPdf(): Promise<void> {
  await Promise.all([loadJpRegularFontBytes(), loadJpBoldFontBytes()]);
}

export async function embedJpFontsForPdfDocument(pdfDoc: PDFDocument): Promise<JpPdfFonts> {
  pdfDoc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([loadJpRegularFontBytes(), loadJpBoldFontBytes()]);
  const [regular, bold] = await Promise.all([
    pdfDoc.embedFont(regularBytes, JP_FONT_EMBED_OPTIONS),
    pdfDoc.embedFont(boldBytes, JP_FONT_EMBED_OPTIONS),
  ]);
  return { regular, bold };
}

function wrapByCharWidth(font: PDFFont, text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = "";
  const chars = Array.from(text);
  for (const ch of chars) {
    const test = line + ch;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = ch;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const COL = {
  slate: rgb(30 / 255, 41 / 255, 59 / 255),
  border: rgb(148 / 255, 163 / 255, 184 / 255),
  headerBg: rgb(241 / 255, 245 / 255, 249 / 255),
  senderBg: rgb(254 / 255, 249 / 255, 195 / 255),
  bankBg: rgb(248 / 255, 250 / 255, 252 / 255),
  white: rgb(1, 1, 1),
  subtotalRow: rgb(248 / 255, 250 / 255, 252 / 255),
};

function baselineY(pageHeight: number, fromTop: number, fontSize: number): number {
  return pageHeight - fromTop - fontSize * 0.72;
}

function drawBorderRect(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  fill: ReturnType<typeof rgb>,
  stroke = COL.border
) {
  page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: stroke, borderWidth: 0.5, color: fill });
}

/** ベースライン直下のアンダーライン（視認性のためやや太め） */
function underlineBelowBaseline(
  page: PDFPage,
  xLeft: number,
  xRight: number,
  baselineYCoord: number,
  thickness = 0.75,
  color = COL.slate
) {
  const y = baselineYCoord - 2.2;
  page.drawLine({
    start: { x: xLeft, y },
    end: { x: xRight, y },
    thickness,
    color,
  });
}

/** 請求 1 ページを pdfDoc に追加（Regular/Bold は既に embed 済み） */
export async function appendInvoicePagesToPdfDocument(
  pdfDoc: PDFDocument,
  fonts: JpPdfFonts,
  model: InvoicePdfModel
): Promise<void> {
  const reg = fonts.regular;
  const bld = fonts.bold;

  const page = pdfDoc.addPage(PageSizes.A4);
  const W = page.getWidth();
  const H = page.getHeight();
  const m = 46;
  const innerW = W - m * 2;
  let fromTop = m;

  const titleSize = 16;
  const body = 10;
  const small = 9;
  const label = 12;
  const amountStrong = 15;

  const addrTop = fromTop;
  const addrLineText = "株式会社RIM 御中";
  const addrBaseline = baselineY(H, addrTop, label);
  page.drawText(addrLineText, {
    x: m,
    y: addrBaseline,
    size: label,
    font: bld,
    color: COL.slate,
  });
  underlineBelowBaseline(page, m, W - m, addrBaseline, 0.85);
  fromTop += label + 10;

  const senderW = 196;
  const senderX = W - m - senderW;
  const addrLine = [model.postalCode ? `〒${model.postalCode}` : "", model.address].filter(Boolean).join(" ");
  const senderParts = [
    addrLine,
    model.memberName,
    model.phoneNumber ? `TEL: ${model.phoneNumber}` : "",
  ].filter((s) => s.length > 0);
  let senderLines: string[] = [];
  for (const part of senderParts) {
    senderLines = senderLines.concat(wrapByCharWidth(reg, part, senderW - 18, small));
  }
  const senderPad = 8;
  const lineH = small * 1.35;
  const senderBoxH = Math.max(44, senderLines.length * lineH + senderPad * 2);
  const senderTop = fromTop;
  drawBorderRect(page, senderX, H - senderTop - senderBoxH, senderW, senderBoxH, COL.senderBg);
  let sy = senderTop + senderPad + small;
  for (const ln of senderLines) {
    page.drawText(ln, {
      x: senderX + 9,
      y: baselineY(H, sy, small),
      size: small,
      font: reg,
      color: COL.slate,
    });
    sy += lineH;
  }

  fromTop = Math.max(fromTop + titleSize + 28, senderTop + senderBoxH + 14);

  const titleBaseline = baselineY(H, fromTop, titleSize);
  page.drawText("請求書", {
    x: W / 2 - bld.widthOfTextAtSize("請求書", titleSize) / 2,
    y: titleBaseline,
    size: titleSize,
    font: bld,
    color: COL.slate,
  });
  const titleUnderlineY = H - fromTop - titleSize - 6;
  page.drawLine({
    start: { x: m, y: titleUnderlineY },
    end: { x: W - m, y: titleUnderlineY },
    thickness: 1.2,
    color: COL.slate,
  });
  fromTop += titleSize + 22;

  const totalStr = `${model.totalWithTax.toLocaleString("ja-JP")} 円 (税込)`;
  const barH = 30;
  const labelW = 76;
  const barTop = fromTop;
  const barBottom = H - barTop - barH;
  drawBorderRect(page, m, barBottom, innerW, barH, COL.white, COL.slate);
  page.drawRectangle({ x: m, y: barBottom, width: labelW, height: barH, color: COL.slate });
  page.drawText("合計", {
    x: m + 16,
    y: baselineY(H, barTop + 9, label),
    size: label,
    font: bld,
    color: COL.white,
  });
  const totalTextX = m + labelW + 12;
  const totalBaseline = baselineY(H, barTop + 8, amountStrong);
  page.drawText(totalStr, {
    x: totalTextX,
    y: totalBaseline,
    size: amountStrong,
    font: bld,
    color: COL.slate,
  });
  underlineBelowBaseline(page, totalTextX, totalTextX + bld.widthOfTextAtSize(totalStr, amountStrong), totalBaseline, 0.9);
  fromTop += barH + 16;

  const infoRowH = 24;
  const L1 = 76;
  const V1 = 132;
  const L2 = 46;
  const V2w = innerW - L1 - V1 - L2;
  const infoRows: [string, string, string?, string?][] = [
    ["請求書No.", model.invoiceNo, "件名", model.subjectLine],
    ["請求期間", model.periodLabel],
    ["支払期限", model.paymentDueDate],
  ];
  let infoTop = fromTop;
  let rowIndex = 0;
  for (const row of infoRows) {
    const [h1, c1, h2, c2] = row;
    const yB = H - infoTop - infoRowH;
    drawBorderRect(page, m, yB, innerW, infoRowH, COL.white);
    page.drawRectangle({ x: m, y: yB, width: L1, height: infoRowH, color: COL.headerBg });
    page.drawText(h1, { x: m + 6, y: baselineY(H, infoTop + 7, body), size: body, font: bld, color: COL.slate });
    if (h2 != null && c2 !== undefined) {
      const c1Disp = wrapByCharWidth(reg, c1, V1 - 10, body)[0] ?? "";
      const c1x = m + L1 + 5;
      const c1Baseline = baselineY(H, infoTop + 7, body);
      page.drawRectangle({ x: m + L1 + V1, y: yB, width: L2, height: infoRowH, color: COL.headerBg });
      page.drawText(c1Disp, {
        x: c1x,
        y: c1Baseline,
        size: body,
        font: reg,
        color: COL.slate,
      });
      if (rowIndex === 0) {
        underlineBelowBaseline(page, c1x, c1x + reg.widthOfTextAtSize(c1Disp, body), c1Baseline, 0.65);
      }
      page.drawText(h2, {
        x: m + L1 + V1 + 5,
        y: baselineY(H, infoTop + 7, body),
        size: body,
        font: bld,
        color: COL.slate,
      });
      const c2Disp = wrapByCharWidth(reg, c2, V2w - 10, body)[0] ?? "";
      const c2x = m + L1 + V1 + L2 + 5;
      const c2Baseline = baselineY(H, infoTop + 7, body);
      page.drawText(c2Disp, {
        x: c2x,
        y: c2Baseline,
        size: body,
        font: reg,
        color: COL.slate,
      });
      if (rowIndex === 0) {
        underlineBelowBaseline(page, c2x, c2x + reg.widthOfTextAtSize(c2Disp, body), c2Baseline, 0.65);
      }
      page.drawLine({
        start: { x: m + L1, y: yB },
        end: { x: m + L1, y: yB + infoRowH },
        thickness: 0.4,
        color: COL.border,
      });
      page.drawLine({
        start: { x: m + L1 + V1, y: yB },
        end: { x: m + L1 + V1, y: yB + infoRowH },
        thickness: 0.4,
        color: COL.border,
      });
      page.drawLine({
        start: { x: m + L1 + V1 + L2, y: yB },
        end: { x: m + L1 + V1 + L2, y: yB + infoRowH },
        thickness: 0.4,
        color: COL.border,
      });
    } else {
      page.drawText(wrapByCharWidth(reg, c1, innerW - L1 - 12, body)[0] ?? "", {
        x: m + L1 + 5,
        y: baselineY(H, infoTop + 7, body),
        size: body,
        font: reg,
        color: COL.slate,
      });
      page.drawLine({
        start: { x: m + L1, y: yB },
        end: { x: m + L1, y: yB + infoRowH },
        thickness: 0.4,
        color: COL.border,
      });
    }
    infoTop += infoRowH;
    rowIndex += 1;
  }
  fromTop = infoTop + 12;

  const isInternInvoice = model.isIntern;
  const colDesc = isInternInvoice ? 150 : 118;
  const colQty = 36;
  const colUnit = 34;
  const colPrice = isInternInvoice ? 0 : 52;
  const colTax = 48;
  const colSub = 56;
  const colTot = 56;
  const sumCols = colDesc + colQty + colUnit + colPrice + colTax + colSub + colTot;
  const scale = innerW / sumCols;
  const cw = {
    d: colDesc * scale,
    q: colQty * scale,
    u: colUnit * scale,
    p: colPrice * scale,
    t: colTax * scale,
    s: colSub * scale,
    g: colTot * scale,
  };
  const headH = 22;
  const rowH = 24;
  const subH = 24;
  const tableTop = fromTop;
  let tx = m;

  const headers = isInternInvoice
    ? ["摘要", "数量", "単位", "消費税", "金額(税抜)", "金額(税込)"]
    : ["摘要", "数量", "単位", "単価", "消費税", "金額(税抜)", "金額(税込)"];
  const colWs = isInternInvoice
    ? [cw.d, cw.q, cw.u, cw.t, cw.s, cw.g]
    : [cw.d, cw.q, cw.u, cw.p, cw.t, cw.s, cw.g];
  drawBorderRect(page, m, H - tableTop - headH, innerW, headH, COL.headerBg);
  for (let i = 0; i < headers.length; i++) {
    const w = colWs[i];
    page.drawText(headers[i], {
      x: tx + 4,
      y: baselineY(H, tableTop + 6, small),
      size: small,
      font: bld,
      color: COL.slate,
    });
    if (i < headers.length - 1) {
      page.drawLine({
        start: { x: tx + w, y: H - tableTop - headH },
        end: { x: tx + w, y: H - tableTop },
        thickness: 0.4,
        color: COL.border,
      });
    }
    tx += w;
  }
  fromTop += headH;

  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  const detailLines = model.detailLines.length > 0 ? model.detailLines : [];
  for (const line of detailLines) {
    const detailTop = fromTop;
    const cells = isInternInvoice
      ? [line.description, line.quantity, line.unit, yen(line.tax), yen(line.subtotal), yen(line.total)]
      : [
          line.description,
          line.quantity,
          line.unit,
          yen(line.unitPriceTaxInclusive),
          yen(line.tax),
          yen(line.subtotal),
          yen(line.total),
        ];
    tx = m;
    page.drawRectangle({ x: m, y: H - detailTop - rowH, width: innerW, height: rowH, borderColor: COL.border, borderWidth: 0.5 });
    for (let i = 0; i < cells.length; i++) {
      const w = colWs[i];
      const txt = cells[i];
      const right = i >= 1;
      const cellFont = i === 0 ? reg : bld;
      const tw = cellFont.widthOfTextAtSize(txt, small);
      const xPos = right ? tx + w - tw - 5 : tx + 4;
      page.drawText(txt, {
        x: xPos,
        y: baselineY(H, detailTop + 6, small),
        size: small,
        font: cellFont,
        color: COL.slate,
      });
      if (i < cells.length - 1) {
        page.drawLine({
          start: { x: tx + w, y: H - detailTop - rowH },
          end: { x: tx + w, y: H - detailTop },
          thickness: 0.4,
          color: COL.border,
        });
      }
      tx += w;
    }
    fromTop += rowH;
  }

  const subTop = fromTop;
  tx = m;
  const subCells = isInternInvoice
    ? ["小計", "", "", yen(model.taxRate), yen(model.subtotal), yen(model.totalWithTax)]
    : ["小計", "", "", "", yen(model.taxRate), yen(model.subtotal), yen(model.totalWithTax)];
  page.drawRectangle({
    x: m,
    y: H - subTop - subH,
    width: innerW,
    height: subH,
    color: COL.subtotalRow,
    borderColor: COL.border,
    borderWidth: 0.5,
  });
  for (let i = 0; i < subCells.length; i++) {
    const w = colWs[i];
    const txt = subCells[i];
    if (txt) {
      const cellFont = i === 0 ? bld : bld;
      const tw = cellFont.widthOfTextAtSize(txt, small);
      const right = i >= 1;
      const xPos = right && i > 0 ? tx + w - tw - 5 : tx + 4;
      page.drawText(txt, {
        x: xPos,
        y: baselineY(H, subTop + 6, small),
        size: small,
        font: cellFont,
        color: COL.slate,
      });
    }
    if (i < subCells.length - 1) {
      page.drawLine({
        start: { x: tx + w, y: H - subTop - subH },
        end: { x: tx + w, y: H - subTop },
        thickness: 0.4,
        color: COL.border,
      });
    }
    tx += w;
  }
  fromTop += subH + 14;

  const sumBoxW = 228;
  const sumBoxX = W - m - sumBoxW;
  const sumRowH = 17;
  let sumY = fromTop;
  const sumBoxPad = 11;
  const sumBoxH = sumRowH * 3 + sumBoxPad * 2 + 4;
  drawBorderRect(page, sumBoxX, H - sumY - sumBoxH, sumBoxW, sumBoxH, COL.white);
  const sums: [string, string][] = [
    ["小計（税抜）", yen(model.subtotal)],
    ["消費税（10%）", yen(model.taxRate)],
    ["合計（税込）", yen(model.totalWithTax)],
  ];
  const sepBeforeTotalY = H - sumY - sumBoxPad - 2 * sumRowH;
  page.drawLine({
    start: { x: sumBoxX + sumBoxPad, y: sepBeforeTotalY },
    end: { x: sumBoxX + sumBoxW - sumBoxPad, y: sepBeforeTotalY },
    thickness: 0.7,
    color: COL.slate,
  });
  for (let i = 0; i < sums.length; i++) {
    const [lab, val] = sums[i];
    const fs = i === 2 ? body : small;
    const labFont = i === 2 ? bld : reg;
    const valFont = i === 2 ? bld : reg;
    page.drawText(lab, {
      x: sumBoxX + sumBoxPad,
      y: baselineY(H, sumY + sumBoxPad + i * sumRowH, fs),
      size: fs,
      font: labFont,
      color: COL.slate,
    });
    const vw = valFont.widthOfTextAtSize(val, fs);
    const valBaseline = baselineY(H, sumY + sumBoxPad + i * sumRowH, fs);
    const valX = sumBoxX + sumBoxW - sumBoxPad - vw;
    page.drawText(val, {
      x: valX,
      y: valBaseline,
      size: fs,
      font: valFont,
      color: COL.slate,
    });
    if (i === 2) {
      underlineBelowBaseline(page, valX, valX + vw, valBaseline, 0.85);
    }
  }
  fromTop += sumBoxH + 16;

  page.drawText("お振込先", {
    x: m,
    y: baselineY(H, fromTop, body),
    size: body,
    font: bld,
    color: COL.slate,
  });
  fromTop += body + 10;

  const bankLine1 = [model.postalCode ? `〒${model.postalCode}` : "", model.address || "（未登録）"].join(" ").trim();
  const bankLine2 = [
    model.bankName || "（未登録）",
    model.branchName,
    model.accountType,
    model.accountNumber,
  ]
    .filter(Boolean)
    .join(" ");
  const bankLine3 = `口座名義: ${model.accountHolder || "（未登録）"}`;
  const bankParts = [bankLine1, bankLine2, bankLine3];
  if (model.invoiceRegistrationLine) {
    bankParts.push(model.invoiceRegistrationLine);
  }
  const bankText = bankParts.join("\n");
  const bankLines = bankText.split("\n").flatMap((line) => wrapByCharWidth(reg, line, innerW - 20, small));
  const bankPad = 14;
  const bankLineHeight = small * 1.42;
  const bankBoxH = Math.max(54, bankLines.length * bankLineHeight + bankPad * 2);
  const bankBoxBottom = H - fromTop - bankBoxH;
  drawBorderRect(page, m, bankBoxBottom, innerW, bankBoxH, COL.bankBg);
  let by = fromTop + bankPad + small;
  for (const bl of bankLines) {
    page.drawText(bl, {
      x: m + 10,
      y: baselineY(H, by, small),
      size: small,
      font: reg,
      color: COL.slate,
    });
    by += bankLineHeight;
  }
  underlineBelowBaseline(page, m + 8, m + innerW - 8, baselineY(H, fromTop + bankPad + small + (bankLines.length - 1) * bankLineHeight, small), 0.75);
}

export async function renderInvoicePdfBlobFromModel(model: InvoicePdfModel): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedJpFontsForPdfDocument(pdfDoc);
  await appendInvoicePagesToPdfDocument(pdfDoc, fonts, model);
  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
}
