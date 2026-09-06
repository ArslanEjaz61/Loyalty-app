import { ImageResponse } from "next/og";

// Generated rather than shipped as a binary so the mark stays in sync with the
// brand colour and needs no design tooling in the build.
export const runtime = "nodejs";

function icon(size) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#C0392B",
          color: "#FFFFFF",
          fontSize: size * 0.42,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          borderRadius: size * 0.22,
        }}
      >
        LC
      </div>
    ),
    { width: size, height: size }
  );
}

export async function GET() {
  return icon(512);
}
