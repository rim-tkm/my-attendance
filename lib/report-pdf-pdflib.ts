import { PDFDocument, PageSizes, PDFFont, rgb } from "pdf-lib";

import type { ReportPdfModel } from "@/lib/report-pdf-model";
import { formatDurationForReport } from "@/lib/report-pdf-model";
import type { JpPdfFonts } from "@/lib/invoice-pdf-pdflib";
import { embedJpFontsForPdfDocument } from "@/lib/invoice-pdf-pdflib";

const COL = {
  slate: rgb(30 / 255, 41 / 255, 59 / 255),
  border: rgb(203 / 255, 213 / 255, 225 / 255),
  headerCell: rgb(248 / 255, 250 / 255, 252 / 255),
  note: rgb(100 / 255, 116 / 255, 139 / 255),
  descBg: rgb(248 / 255, 250 / 255, 252 / 255),
};

function baselineY(pageHeight: number, fromTop: number, fontSize: number): number {
  return pageHeight - fromTop - fontSize * 0.72;
}

function wrapByCharWidth(font: PDFFont, text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of Array.from(text)) {
    const test = line + ch;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = ch;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function pct(n: number | null): string {
  return n != null ? `${n}%` : "—";
}

/** 実績報告ページを pdfDoc に追加（Regular / Bold は呼び出し側で embed 済み） */
export async function appendReportPagesToPdfDocument(
  pdfDoc: PDFDocument,
  fonts: JpPdfFonts,
  model: ReportPdfModel
): Promise<void> {
  const reg = fonts.regular;
  const bld = fonts.bold;

  const body = 10;
  const small = 9;
  const secTitle = 12;
  const title = 15;
  const company = 14;
  const noteFs = 8.5;
  const kvRowH = 20;
  const m = 46;
  const innerW = 595.28 - m * 2;
  const bottomGuard = 56;

  let page = pdfDoc.addPage(PageSizes.A4);
  let H = page.getHeight();
  let fromTop = m;

  const ensureSpace = (need: number): void => {
    if (fromTop + need > H - bottomGuard) {
      page = pdfDoc.addPage(PageSizes.A4);
      H = page.getHeight();
      fromTop = m;
    }
  };

  page.drawText("株式会社RIM", {
    x: m + innerW / 2 - bld.widthOfTextAtSize("株式会社RIM", company) / 2,
    y: baselineY(H, fromTop, company),
    size: company,
    font: bld,
    color: COL.slate,
  });
  fromTop += company + 8;
  page.drawText("業務委託実績報告書", {
    x: m + innerW / 2 - bld.widthOfTextAtSize("業務委託実績報告書", title) / 2,
    y: baselineY(H, fromTop, title),
    size: title,
    font: bld,
    color: COL.slate,
  });
  fromTop += title + 16;
  page.drawLine({
    start: { x: m, y: H - fromTop },
    end: { x: m + innerW, y: H - fromTop },
    thickness: 1,
    color: COL.slate,
  });
  fromTop += 20;

  const drawSectionTitle = (t: string) => {
    fromTop += 10;
    ensureSpace(secTitle + 28);
    page.drawText(t, {
      x: m,
      y: baselineY(H, fromTop, secTitle),
      size: secTitle,
      font: bld,
      color: COL.slate,
    });
    fromTop += secTitle + 6;
    page.drawLine({
      start: { x: m, y: H - fromTop },
      end: { x: m + innerW, y: H - fromTop },
      thickness: 0.5,
      color: COL.border,
    });
    fromTop += 12;
  };

  const drawKeyValueRow = (label: string, value: string, labelW = 120) => {
    ensureSpace(kvRowH + 6);
    const yB = H - fromTop - kvRowH;
    page.drawRectangle({
      x: m,
      y: yB,
      width: labelW,
      height: kvRowH,
      borderColor: COL.border,
      borderWidth: 0.45,
      color: COL.headerCell,
    });
    page.drawRectangle({
      x: m + labelW,
      y: yB,
      width: innerW - labelW,
      height: kvRowH,
      borderColor: COL.border,
      borderWidth: 0.45,
    });
    const textPad = 6;
    page.drawText(label, {
      x: m + textPad,
      y: baselineY(H, fromTop + textPad, body),
      size: body,
      font: bld,
      color: COL.slate,
    });
    const vw = innerW - labelW - textPad * 2;
    const lines = wrapByCharWidth(reg, value, vw, body);
    page.drawText(lines[0] ?? "", {
      x: m + labelW + textPad,
      y: baselineY(H, fromTop + textPad, body),
      size: body,
      font: reg,
      color: COL.slate,
    });
    fromTop += kvRowH;
  };

  drawSectionTitle("1. 基本情報");
  drawKeyValueRow("メンバー名", model.memberName);
  drawKeyValueRow("対象月", model.monthLabel);
  if (model.isIntern) {
    drawKeyValueRow("契約形態", "成果報酬型（インターン）");
    drawKeyValueRow(
      "決裁者商談単価",
      `¥${(model.internRateDecisionMaker ?? 0).toLocaleString("ja-JP")} /件（税込）`
    );
    drawKeyValueRow(
      "非決裁者商談単価",
      `¥${(model.internRateNonDecisionMaker ?? 0).toLocaleString("ja-JP")} /件（税込）`
    );
  } else {
    drawKeyValueRow("契約形態", "時給制（一般）");
    drawKeyValueRow("委託料単価", `¥${model.hourlyRate.toLocaleString("ja-JP")} /時間`);
  }

  drawSectionTitle("2. 稼働統計");
  if (model.isIntern) {
    drawKeyValueRow("決裁者商談確定（合計）", `${model.confirmedDecisionCount ?? 0} 件`);
    drawKeyValueRow("非決裁者商談確定（合計）", `${model.confirmedNonDecisionCount ?? 0} 件`);
    drawKeyValueRow("請求額（税込）", `¥${model.grossPayTaxInclusive.toLocaleString("ja-JP")}`);
  } else {
    drawKeyValueRow("総稼働時間（合計）", formatDurationForReport(model.totalMinutes));
    drawKeyValueRow("業務日数", `${model.workDays} 日`);
    drawKeyValueRow("概算委託料", `¥${model.grossPayTaxInclusive.toLocaleString("ja-JP")}`);
  }
  fromTop += 4;
  page.drawText(
    model.isIntern
      ? "※本金額は管理者承認済みの商談確定数に基づく成果報酬（税込）です。"
      : "※本金額は業務委託契約に基づく、稼働時間に応じた委託料の概算です。",
    {
    x: m,
    y: baselineY(H, fromTop, noteFs),
    size: noteFs,
    font: reg,
    color: COL.note,
  });
  fromTop += noteFs + 16;

  drawSectionTitle("3. 業務遂行内容");
  ensureSpace(40);
  const descBoxH = 32;
  page.drawRectangle({
    x: m,
    y: H - fromTop - descBoxH,
    width: innerW,
    height: descBoxH,
    borderColor: COL.border,
    borderWidth: 0.45,
    color: COL.descBg,
  });
  page.drawText("指定リストへの架電、および進捗データの入力", {
    x: m + 10,
    y: baselineY(H, fromTop + 9, body),
    size: body,
    font: reg,
    color: COL.slate,
  });
  fromTop += descBoxH + 6;

  drawSectionTitle("4. 生産性スコア");
  drawKeyValueRow("総コール数", String(model.totalCalls));
  drawKeyValueRow("総有効コール数", String(model.validCalls));
  drawKeyValueRow("決裁者対話数（KC）", String(model.kcCount));
  drawKeyValueRow("決裁者アポ数", String(model.decisionMakerApo));
  drawKeyValueRow("有効率", pct(model.validRate));
  drawKeyValueRow("KC率（決裁者接続率）", pct(model.kcRate));
  drawKeyValueRow("アポ率", pct(model.apoRate));

  drawSectionTitle("5. 日別明細");
  const headH = 22;
  ensureSpace(headH + 12);
  const cwDate = innerW * 0.22;
  const cwApo = innerW * 0.12;
  const cwTime = innerW - cwDate - cwApo;
  const drawDailyHeader = (continuation: boolean) => {
    const hb = H - fromTop - headH;
    page.drawRectangle({ x: m, y: hb, width: cwDate, height: headH, color: COL.headerCell, borderColor: COL.border, borderWidth: 0.45 });
    page.drawRectangle({
      x: m + cwDate,
      y: hb,
      width: cwTime,
      height: headH,
      color: COL.headerCell,
      borderColor: COL.border,
      borderWidth: 0.45,
    });
    page.drawRectangle({
      x: m + cwDate + cwTime,
      y: hb,
      width: cwApo,
      height: headH,
      color: COL.headerCell,
      borderColor: COL.border,
      borderWidth: 0.45,
    });
    const h1 = continuation ? "日付（続き）" : "日付";
    page.drawText(h1, {
      x: m + 6,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: bld,
      color: COL.slate,
    });
    page.drawText("業務開始・終了時間", {
      x: m + cwDate + 6,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: bld,
      color: COL.slate,
    });
    const apoHead = "獲得アポ数";
    page.drawText(apoHead, {
      x: m + cwDate + cwTime + cwApo - bld.widthOfTextAtSize(apoHead, small) - 6,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: bld,
      color: COL.slate,
    });
    fromTop += headH;
  };

  drawDailyHeader(false);

  const drawDailyRow = (row: { displayDate: string; timeRangesText: string; apoCount: number }) => {
    const timeLines = wrapByCharWidth(reg, row.timeRangesText || "—", cwTime - 12, small);
    const lineCount = Math.max(1, timeLines.length);
    const linePitch = small * 1.28;
    const rowH = Math.max(22, 10 + (lineCount - 1) * linePitch + 10);
    ensureSpace(rowH + 6);
    const yB = H - fromTop - rowH;
    page.drawRectangle({ x: m, y: yB, width: cwDate, height: rowH, borderColor: COL.border, borderWidth: 0.45 });
    page.drawRectangle({ x: m + cwDate, y: yB, width: cwTime, height: rowH, borderColor: COL.border, borderWidth: 0.45 });
    page.drawRectangle({
      x: m + cwDate + cwTime,
      y: yB,
      width: cwApo,
      height: rowH,
      borderColor: COL.border,
      borderWidth: 0.45,
    });
    page.drawText(row.displayDate, {
      x: m + 6,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: reg,
      color: COL.slate,
    });
    let ty = fromTop + 6;
    for (let li = 0; li < timeLines.length; li++) {
      page.drawText(timeLines[li] ?? "", {
        x: m + cwDate + 6,
        y: baselineY(H, ty, small),
        size: small,
        font: reg,
        color: COL.slate,
      });
      ty += linePitch;
    }
    const apoStr = String(row.apoCount);
    page.drawText(apoStr, {
      x: m + cwDate + cwTime + cwApo - reg.widthOfTextAtSize(apoStr, small) - 6,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: bld,
      color: COL.slate,
    });
    fromTop += rowH;
  };

  if (model.dailyRows.length === 0) {
    const emptyH = 22;
    ensureSpace(emptyH + 6);
    const yB = H - fromTop - emptyH;
    page.drawRectangle({ x: m, y: yB, width: innerW, height: emptyH, borderColor: COL.border, borderWidth: 0.45 });
    page.drawText("該当データがありません", {
      x: m + 10,
      y: baselineY(H, fromTop + 6, small),
      size: small,
      font: reg,
      color: COL.slate,
    });
    fromTop += emptyH;
  } else {
    for (const row of model.dailyRows) {
      if (fromTop + 30 > H - bottomGuard) {
        page = pdfDoc.addPage(PageSizes.A4);
        H = page.getHeight();
        fromTop = m;
        drawDailyHeader(true);
      }
      drawDailyRow(row);
    }
  }
}

export async function renderReportPdfBlobFromModel(model: ReportPdfModel): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedJpFontsForPdfDocument(pdfDoc);
  await appendReportPagesToPdfDocument(pdfDoc, fonts, model);
  const out = await pdfDoc.save();
  return new Blob([new Uint8Array(out)], { type: "application/pdf" });
}
