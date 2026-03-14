"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f1f5f9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          maxWidth: "28rem",
          width: "100%",
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "2rem",
          boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.5rem" }}>
          エラーが発生しました
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1rem" }}>
          {error.message || "ページの読み込みに失敗しました。"}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#334155",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          再試行
        </button>
      </div>
    </div>
  );
}
