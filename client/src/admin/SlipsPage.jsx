import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { getSlips } from "../lib/adminApi.js";

// A4 print sheet of sign-in slips (SPEC 6.4). One slip per code, each
// carrying only the code and the first-time PIN instructions — no name, no
// roster label, nothing that identifies a person. Identity is verified in
// the room against the facilitator's own attendance sheet; the slip is
// just the credential.
//
// The print CSS is scoped to this page via a wrapper class and injected
// only while this component is mounted, so it can never affect the rest of
// the console.
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #fff !important; }
  .slips-noprint { display: none !important; }
  .slips-sheet { margin: 0 !important; }
  .slip {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
.slips-sheet { max-width: 186mm; margin: 0 auto; }
.slip {
  border: 1px solid #16243D;
  border-radius: 6px;
  padding: 9mm 12mm;
  margin-bottom: 4mm;
}
.slip + .cutline {
  border-top: 1px dashed #94a3b8;
  text-align: center;
  font-size: 10px;
  color: #94a3b8;
  margin: 0 0 4mm 0;
  padding-top: 2px;
}
.slip-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #16243D;
}
`;

const Slip = ({ code, arm, instructions }) => (
  <div className="slip">
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <span className="slip-code">{code}</span>
      <span style={{ fontSize: 11, color: "#64748b" }}>Arm {arm}</span>
    </div>
    <p style={{ margin: "5mm 0 2mm", fontSize: 12, fontWeight: 600, color: "#16243D" }}>Signing in for the first time</p>
    <ol style={{ margin: 0, paddingLeft: "5mm", fontSize: 12, lineHeight: 1.55, color: "#16243D" }}>
      {instructions.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ol>
    <p style={{ marginTop: "4mm", fontSize: 10, color: "#94a3b8" }}>
      Keep this slip. If you forget your PIN, a facilitator can reset it — you'll then choose a new one.
    </p>
  </div>
);

export const SlipsPage = () => {
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const sessionId = params.get("sessionId") || undefined;
  const arm = params.get("arm") || undefined;
  const ids = params.get("ids") || undefined;

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    setError(null);
    setData(null);
    getSlips({ sessionId, arm, ids: ids ? ids.split(",") : undefined })
      .then(setData)
      .catch(e => setError(e.message));
  }, [sessionId, arm, ids]);

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#16243D", padding: "16px" }}>
      <div className="slips-noprint" style={{ maxWidth: "186mm", margin: "0 auto 16px" }}>
        <Link to="/admin/people" style={{ fontSize: 11, textDecoration: "underline" }}>
          ← Participants
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, fontFamily: "Fredoka, sans-serif", margin: 0 }}>Sign-in slips</h1>
            <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
              {data ? `${data.slips.length} slip${data.slips.length === 1 ? "" : "s"}` : "Loading…"}
              {sessionId ? " · one session" : ""}
              {arm ? ` · arm ${arm}` : ""}
              {" · "}cut along the dashed lines
            </p>
          </div>
          <button
            type="button"
            data-testid="do-print"
            onClick={() => window.print()}
            disabled={!data || data.slips.length === 0}
            style={{
              borderRadius: 6,
              background: "#34D399",
              color: "#16243D",
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 14px",
              border: "none",
              cursor: "pointer",
              opacity: !data || data.slips.length === 0 ? 0.5 : 1
            }}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {error && (
        <p className="slips-noprint" style={{ maxWidth: "186mm", margin: "0 auto", color: "#FF6B5B", fontSize: 12 }}>
          {error}
        </p>
      )}

      {data && data.slips.length === 0 && (
        <p className="slips-noprint" style={{ maxWidth: "186mm", margin: "0 auto", color: "#94a3b8", fontSize: 12 }}>
          No codes match this selection. Generate a batch from the Participants screen first.
        </p>
      )}

      {data && data.slips.length > 0 && (
        <div className="slips-sheet" data-testid="slips-sheet">
          {data.slips.map((slip, i) => (
            <div key={`${slip.code}-${i}`}>
              <Slip code={slip.code} arm={slip.arm} instructions={data.pinInstructions} />
              {i < data.slips.length - 1 && <div className="cutline">✂ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
