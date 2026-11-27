"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[panel] global error:", error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "16px",
        }}
      >
        <div
          style={{
            maxWidth: "460px",
            width: "100%",
            backgroundColor: "#ffffff",
            border: "1px solid #fecdd3",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 10px 25px rgba(15, 23, 42, 0.06)",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: "18px", fontWeight: 700 }}>
            بارگذاری پنل با خطای سرور مواجه شد
          </h1>
          <p style={{ margin: "0 0 16px", fontSize: "14px", lineHeight: 1.7, color: "#475569" }}>
            پاسخ معتبری از سرور دریافت نشد. پس از بررسی وضعیت سرویس، مهاجرت دیتابیس و اتصال پایگاه‌داده دوباره تلاش کنید.
          </p>
          {error?.digest && (
            <p
              dir="ltr"
              style={{
                margin: "0 0 16px",
                padding: "8px 10px",
                borderRadius: "8px",
                backgroundColor: "#f1f5f9",
                fontSize: "12px",
                fontFamily: "monospace",
                color: "#334155",
              }}
            >
              ERROR {error.digest}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: "10px",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 600,
                backgroundColor: "#4f46e5",
                color: "#ffffff",
              }}
            >
              تلاش مجدد
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 600,
                backgroundColor: "#ffffff",
                color: "#1e293b",
              }}
            >
              بارگذاری مجدد
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
