/**
 * 請求書一括記帳 Webhook（GAS）
 *
 * 勤怠アプリ POST /api/admin/invoice-batch-export から
 * { token, yearMonth, rows } を受け取り、Drive 保存 + スプレッドシート追記を行う。
 *
 * 【重要】PDF は pdfBase64 をそのまま createFile に渡さないこと。
 * 必ず Utilities.base64Decode → Utilities.newBlob → folder.createFile(blob) を使う。
 *
 * 推奨: アプリ側で INVOICE_DRIVE_* を設定し driveFileId のみ受け取る（PDF バイナリは GAS を通さない）。
 */

var INVOICE_GAS_TOKEN = "your-invoice-gas-token";
/** 月別フォルダの親（driveFileId 未使用時のみ） */
var INVOICE_DRIVE_ROOT_FOLDER_ID = "your-root-folder-id";
/** 記帳先スプレッドシート ID */
var INVOICE_SPREADSHEET_ID = "your-spreadsheet-id";
/** 記帳シート名 */
var INVOICE_SHEET_NAME = "請求書";

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!payload || payload.token !== INVOICE_GAS_TOKEN) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
    var yearMonth = String(payload.yearMonth || "").trim();
    var rows = payload.rows;
    if (!yearMonth || !rows || !rows.length) {
      return jsonResponse({ ok: false, error: "yearMonth and rows are required" }, 400);
    }

    var monthFolder = getOrCreateMonthFolder_(yearMonth);
    var sheet = SpreadsheetApp.openById(INVOICE_SPREADSHEET_ID).getSheetByName(INVOICE_SHEET_NAME);
    if (!sheet) {
      throw new Error("シートが見つかりません: " + INVOICE_SHEET_NAME);
    }

    var inserted = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var fileMeta = saveInvoicePdfRow_(row, monthFolder);
      appendSpreadsheetRow_(sheet, row, fileMeta);
      inserted++;
    }

    return jsonResponse({ ok: true, inserted: inserted, yearMonth: yearMonth });
  } catch (err) {
    console.error("invoice webhook failed:", err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function saveInvoicePdfRow_(row, monthFolder) {
  var fileName = String(row.fileName || "請求書.pdf");

  // 1) アプリ側 Drive 直アップロード（推奨・PDF バイナリを GAS で触らない）
  if (row.driveFileId) {
    var existing = DriveApp.getFileById(String(row.driveFileId));
    return {
      fileId: existing.getId(),
      fileUrl: row.driveViewUrl || existing.getUrl(),
      fileName: existing.getName(),
    };
  }

  // 2) pdfUrl から取得（base64 回避用）
  if (row.pdfUrl) {
    var fetched = UrlFetchApp.fetch(String(row.pdfUrl), { muteHttpExceptions: true });
    if (fetched.getResponseCode() !== 200) {
      throw new Error("pdfUrl fetch failed: " + fetched.getResponseCode());
    }
    var fetchedBlob = fetched.getBlob().setName(fileName);
    assertPdfBlob_(fetchedBlob);
    var savedFromUrl = monthFolder.createFile(fetchedBlob);
    return { fileId: savedFromUrl.getId(), fileUrl: savedFromUrl.getUrl(), fileName: savedFromUrl.getName() };
  }

  // 3) pdfBase64（従来方式・デコード必須）
  if (!row.pdfBase64) {
    throw new Error("PDF データがありません（driveFileId / pdfUrl / pdfBase64 のいずれかが必要）");
  }
  var bytes = Utilities.base64Decode(String(row.pdfBase64));
  assertPdfBytes_(bytes);
  var blob = Utilities.newBlob(bytes, "application/pdf", fileName);
  var saved = monthFolder.createFile(blob);
  return { fileId: saved.getId(), fileUrl: saved.getUrl(), fileName: saved.getName() };
}

function assertPdfBytes_(bytes) {
  if (!bytes || bytes.length < 100) {
    throw new Error("PDF bytes too small");
  }
  var head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head !== "%PDF") {
    throw new Error("Invalid PDF magic bytes (expected %PDF)");
  }
}

function assertPdfBlob_(blob) {
  var bytes = blob.getBytes();
  assertPdfBytes_(bytes);
}

function appendSpreadsheetRow_(sheet, row, fileMeta) {
  sheet.appendRow([
    row.clientName || "",
    row.paymentDate || "",
    row.country || "JAPAN",
    row.invoiceNo || "",
    row.invoiceDate || "",
    row.amount != null ? row.amount : "",
    fileMeta.fileUrl || "",
    fileMeta.fileName || "",
  ]);
}

function getOrCreateMonthFolder_(yearMonth) {
  var root = DriveApp.getFolderById(INVOICE_DRIVE_ROOT_FOLDER_ID);
  var folders = root.getFoldersByName(yearMonth);
  if (folders.hasNext()) {
    return folders.next();
  }
  return root.createFolder(yearMonth);
}

function jsonResponse(obj, statusCode) {
  var out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
  // Web アプリの doPost では setStatusCode は使えない環境があるため省略
  return out;
}

/** 手動テスト: 最新行の pdfBase64 保存が正しいか確認 */
function testDecodePdfMagicFromPayloadSample() {
  var sample = "%PDF-1.7\n";
  var encoded = Utilities.base64Encode(sample);
  var decoded = Utilities.base64Decode(encoded);
  Logger.log(String.fromCharCode(decoded[0], decoded[1], decoded[2], decoded[3]));
}
