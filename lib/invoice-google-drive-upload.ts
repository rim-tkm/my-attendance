import { createSign } from "node:crypto";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizePrivateKeyPem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

export function isInvoiceDriveUploadConfigured(): boolean {
  return Boolean(
    process.env.INVOICE_DRIVE_ROOT_FOLDER_ID?.trim() &&
      process.env.INVOICE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.INVOICE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
  );
}

export function assertValidPdfBytes(bytes: Uint8Array): void {
  if (bytes.length < 100) {
    throw new Error("PDF バイナリが小さすぎます");
  }
  const head = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (head !== "%PDF") {
    throw new Error("PDF マジックバイト (%PDF) が一致しません");
  }
}

let accessTokenCache: { token: string; expiresAt: number } | null = null;

export async function getInvoiceDriveAccessToken(): Promise<string> {
  const clientEmail = process.env.INVOICE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKeyRaw = process.env.INVOICE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!clientEmail || !privateKeyRaw) {
    throw new Error("Drive サービスアカウントの環境変数が未設定です");
  }

  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.token;
  }

  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      exp: iat + 3600,
      iat,
    })
  );
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(normalizePrivateKeyPem(privateKeyRaw));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Drive トークン取得失敗: ${json.error ?? res.status}`);
  }
  accessTokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

async function driveJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    throw new Error(`Drive API 応答が JSON ではありません (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`Drive API エラー (${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

async function findChildFolderId(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await driveJson<{ files?: { id: string }[] }>(
    accessToken,
    `${DRIVE_API}/files?q=${q}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  return data.files?.[0]?.id ?? null;
}

async function createChildFolder(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<string> {
  const data = await driveJson<{ id: string }>(accessToken, `${DRIVE_API}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  if (!data.id) throw new Error("Drive フォルダ作成に失敗しました");
  return data.id;
}

export async function ensureInvoiceMonthFolderId(yearMonth: string): Promise<string> {
  const rootId = process.env.INVOICE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!rootId) throw new Error("INVOICE_DRIVE_ROOT_FOLDER_ID が未設定です");
  const accessToken = await getInvoiceDriveAccessToken();
  const existing = await findChildFolderId(accessToken, rootId, yearMonth);
  if (existing) return existing;
  return createChildFolder(accessToken, rootId, yearMonth);
}

export async function uploadInvoicePdfToDrive(params: {
  yearMonth: string;
  fileName: string;
  pdfBytes: Uint8Array;
}): Promise<{ fileId: string; webViewLink: string; folderId: string }> {
  assertValidPdfBytes(params.pdfBytes);
  const accessToken = await getInvoiceDriveAccessToken();
  const folderId = await ensureInvoiceMonthFolderId(params.yearMonth);

  const boundary = `pdf-upload-${Date.now()}`;
  const metadata = JSON.stringify({
    name: params.fileName,
    parents: [folderId],
  });
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(preamble, "utf8"),
    Buffer.from(params.pdfBytes),
    Buffer.from(closing, "utf8"),
  ]);

  const res = await fetch(`${DRIVE_API}/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const text = await res.text();
  let json: { id?: string; webViewLink?: string; error?: { message?: string } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Drive アップロード応答が JSON ではありません (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || !json.id) {
    throw new Error(`Drive PDF アップロード失敗 (${res.status}): ${json.error?.message ?? text.slice(0, 300)}`);
  }
  return {
    fileId: json.id,
    webViewLink: json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`,
    folderId,
  };
}
