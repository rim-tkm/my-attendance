/** メンバー／管理者 UI からサーバー生成 PDF を取得してダウンロードする */

function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : null;
}

export async function fetchMemberCombinedPdfFromServer(
  yearMonth: string,
  options?: { memberId?: string }
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch("/api/member/combined-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      yearMonth,
      ...(options?.memberId ? { memberId: options.memberId } : {}),
    }),
  });
  if (!res.ok) {
    let message = `PDF生成に失敗しました (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const fileName = fileNameFromContentDisposition(res.headers.get("Content-Disposition")) ?? "invoice.pdf";
  return { blob, fileName };
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
