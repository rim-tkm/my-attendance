/**
 * Googleフォーム → 勤怠アプリ メンバー自動登録（GAS）
 *
 * Webhook: POST /api/webhooks/google-form-register
 * インボイス: 13番（あり/なし）+ 14番（T番号）→ invoice_registration_number に統合して送信
 */

var WEBHOOK_URL = "https://your-app.vercel.app/api/webhooks/google-form-register";
var EXTERNAL_REGISTER_SECRET = "your-long-random-secret";

var LABEL_INVOICE_HAS = "インボイス番号";
var LABEL_INVOICE_DETAIL = "インボイス番号をあるにした方は以下に記載";

function onFormSubmit(e) {
  try {
    registerMemberFromFormResponses_(e.namedValues);
  } catch (err) {
    console.error("onFormSubmit failed:", err);
    throw err;
  }
}

function testRegisterLatestResponse() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var lastRow = sheet.getRange(sheet.getLastRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
  var named = {};
  for (var i = 0; i < headers.length; i++) {
    named[String(headers[i])] = [String(lastRow[i] || "")];
  }
  registerMemberFromFormResponses_(named);
}

function registerMemberFromFormResponses_(namedValues) {
  var flat = flattenNamedValues_(namedValues);
  flat.invoice_registration_number = resolveInvoiceRegistrationForGas_(flat);
  Logger.log("送信済みJSON: " + JSON.stringify(flat));

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + EXTERNAL_REGISTER_SECRET,
    },
    payload: JSON.stringify(flat),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
  var status = response.getResponseCode();
  var bodyText = response.getContentText();
  Logger.log("結果: " + bodyText);

  if (status < 200 || status >= 300) {
    console.error("Webhook failed:", status, bodyText);
    throw new Error("登録 API エラー (" + status + "): " + bodyText);
  }

  return JSON.parse(bodyText);
}

/**
 * 13番（あり/なし）と 14番（T番号）を統合。T+13桁があればそれを、なければ空文字。
 */
function resolveInvoiceRegistrationForGas_(flat) {
  var hasVal = pickByPartialKey_(flat, [LABEL_INVOICE_HAS, "インボイス番号"]);
  var detailVal = pickByPartialKey_(flat, [LABEL_INVOICE_DETAIL, "以下に記載"]);

  var fromDetail = extractTRegistration_(detailVal);
  if (fromDetail) return fromDetail;

  var fromHas = extractTRegistration_(hasVal);
  if (fromHas) return fromHas;

  if (flat.invoice_registration_number) {
    return extractTRegistration_(String(flat.invoice_registration_number)) || "";
  }

  return "";
}

function extractTRegistration_(raw) {
  if (!raw) return "";
  var s = String(raw).trim().replace(/[\s\-－ー]/g, "").toUpperCase();
  if (s === "" || s === "あり" || s === "なし") return "";
  var m = s.match(/T(\d{13})/);
  return m ? "T" + m[1] : "";
}

function flattenNamedValues_(namedValues) {
  var payload = {};
  for (var key in namedValues) {
    if (!namedValues.hasOwnProperty(key)) continue;
    var arr = namedValues[key];
    var val = Array.isArray(arr) ? arr[0] : arr;
    payload[key] = val !== undefined && val !== null ? String(val).trim() : "";
  }
  return payload;
}

function pickByPartialKey_(obj, keywords) {
  for (var key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    var matched = keywords.some(function (kw) {
      return key.indexOf(kw) !== -1;
    });
    if (!matched) continue;
    var v = obj[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}
