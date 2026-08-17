"use client";

import type NextError from "next/error";

type GlobalErrorProperties = {
  readonly error: NextError & { digest?: string };
  readonly reset: () => void;
};

const GlobalError = ({ reset }: GlobalErrorProperties) => (
  <html lang="ko">
    <body
      style={{
        margin: 0,
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        background: "#0a0412",
        color: "#fffcf6",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "grid", gap: 16, textAlign: "center" }}>
        <h1>무대 준비 중 문제가 생겼어요</h1>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            minHeight: 52,
            padding: "0 24px",
            border: "2px solid #fae08c",
            borderRadius: 6,
            background: "#f7be3c",
            color: "#0a0412",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </div>
    </body>
  </html>
);

export default GlobalError;
