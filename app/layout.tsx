import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "稼働管理アプリ",
  description: "業務委託向け稼働時間管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className="min-h-screen bg-slate-100 text-slate-900 antialiased"
        style={{ backgroundColor: "#f1f5f9", minHeight: "100vh" }}
      >
        <noscript>
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#94a3b8",
              padding: "2rem",
              fontFamily: "system-ui, sans-serif",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "1.125rem", fontWeight: 600, color: "#0f172a" }}>
              JavaScript を有効にしてください。または
              <a href="http://localhost:3000" style={{ color: "#1d4ed8", marginLeft: "0.25rem" }}>http://localhost:3000</a>
              で開き直してください。
            </p>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
