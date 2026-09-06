"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { apiUrl } from "../base.js";

/**
 * Till screen: sign in, scan a customer, record the bill.
 *
 * Scanning decodes frames with jsQR, which works in every browser — the native
 * BarcodeDetector is used first where it exists (Chrome/Android) because it is
 * faster, but iOS Safari has no such API and previously showed no camera at
 * all. Typing the eight-character code stays available as the fallback.
 */
export default function Staff() {
  const [staff, setStaff] = useState(null);
  const [login, setLogin] = useState({ username: "", pin: "" });
  const [scanned, setScanned] = useState(null);
  const [manualToken, setManualToken] = useState("");
  const [bill, setBill] = useState({ invoiceNumber: "", amount: "", redeemRewardId: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const [scanHint, setScanHint] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);

  useEffect(() => {
    // jsQR needs no platform support, so the camera is offered wherever the
    // browser can reach one at all.
    setCanScan(
      typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)
    );
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setScanHint("");
  }

  async function startCamera() {
    setErr("");
    setScanHint("Starting camera…");
    // Mount the <video> first: on iOS the element must already be in the DOM
    // with playsinline set before a stream is attached, or it renders black.
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("no video element");

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.muted = true;

      // Safari often has no dimensions until metadata arrives, and play()
      // before that point resolves without ever producing a frame.
      await new Promise((resolve) => {
        if (video.readyState >= 1) return resolve();
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 3000);
      });

      try {
        await video.play();
      } catch {
        // Autoplay refused — the stream is live, so a tap on the video starts it.
        setScanHint("Tap the video to start the camera");
      }

      setScanHint("Point at the customer's QR code");

      // Native decoder where available, jsQR everywhere else.
      const detector =
        typeof window !== "undefined" && "BarcodeDetector" in window
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null;

      loopRef.current = setInterval(async () => {
        const v = videoRef.current;
        // readyState 2 is enough to grab a frame; waiting for 4 can stall on iOS.
        if (!v || v.readyState < 2 || !v.videoWidth) return;

        let value = null;

        if (detector) {
          try {
            const codes = await detector.detect(v);
            if (codes.length > 0) value = codes[0].rawValue;
          } catch {
            /* frame not ready */
          }
        } else {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, w, h);
          try {
            const img = ctx.getImageData(0, 0, w, h);
            const found = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (found?.data) value = found.data;
          } catch {
            /* frame not ready */
          }
        }

        if (value) {
          stopCamera();
          doScan(value);
        }
      }, 300);
    } catch {
      setErr("Could not open the camera — enter the code by hand instead.");
      setScanning(false);
    }
  }

  async function doLogin(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch(apiUrl("/api/staff/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not sign in.");
      setStaff(d.staff);
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  }

  async function doScan(token) {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch(apiUrl("/api/staff/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not read that code.");
      setScanned(d);
      setManualToken("");
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  }

  async function submitBill(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch(apiUrl("/api/staff/transaction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: scanned.token,
          invoiceNumber: bill.invoiceNumber,
          amount: bill.amount,
          redeemRewardId: bill.redeemRewardId || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setResult(d);
      setScanned(null);
      setBill({ invoiceNumber: "", amount: "", redeemRewardId: "" });
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  }

  // ---------- signed out
  if (!staff) {
    return (
      <div className="shell">
        <div className="brandbar">
          <div className="brandmark">ST</div>
          <div>
            <div className="brandname">Staff counter</div>
            <div className="brandsub">Sign in to continue</div>
          </div>
        </div>
        <div className="card">
          <h1>Sign in</h1>
          <form onSubmit={doLogin}>
            <div className="field">
              <label className="label" htmlFor="u">Username</label>
              <input id="u" className="input" value={login.username} autoComplete="username"
                     onChange={(e) => setLogin({ ...login, username: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="p">PIN</label>
              <input id="p" className="input" type="password" inputMode="numeric" autoComplete="current-password"
                     value={login.pin} onChange={(e) => setLogin({ ...login, pin: e.target.value })} />
            </div>
            <button className="btn" disabled={busy}>
              {busy ? <><span className="spin" /> Checking…</> : "Sign in"}
            </button>
          </form>
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    );
  }

  // ---------- signed in
  return (
    <div className="shell">
      <div className="brandbar">
        <div className="brandmark">ST</div>
        <div>
          <div className="brandname">{staff.name}</div>
          <div className="brandsub">
            {staff.branch ? `${staff.branch.name} · ${staff.branch.city}` : staff.role}
          </div>
        </div>
      </div>

      {result && (
        <div className="card">
          <div className="note">
            Saved — {result.customer.name} now has {result.customer.pointsBalance} points
            and {result.customer.visitCount} visit{result.customer.visitCount === 1 ? "" : "s"}.
          </div>
          <div className="tx-row">
            <div><span className="b">Invoice {result.transaction.invoiceNumber}</span></div>
            <div className="p">+{result.transaction.pointsEarned} pts</div>
          </div>
          {result.redeemed && (
            <div className="tx-row"><div className="b">Redeemed: {result.redeemed.name}</div></div>
          )}
          {result.newRewards?.map((n) => (
            <div key={n.id} className="reward-row">
              <div className="ic">★</div>
              <div><div className="nm">Unlocked: {n.name}</div><div className="ds">{n.description}</div></div>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setResult(null)}>
            Next customer
          </button>
        </div>
      )}

      {!scanned && !result && (
        <div className="card">
          <h1>Scan customer</h1>
          <p className="sub">Ask the customer to open their loyalty card.</p>

          {scanning ? (
            <>
              <div className="scanbox">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  onClick={() => videoRef.current?.play().catch(() => {})}
                />
                <div className="scanframe" />
              </div>
              <canvas ref={canvasRef} style={{ display: "none" }} />
              {scanHint && <div className="scanhint">{scanHint}</div>}
              <button className="btn btn-ghost" onClick={stopCamera}>Stop camera</button>
            </>
          ) : (
            canScan && (
              <button className="btn" onClick={startCamera} style={{ marginBottom: 14 }}>
                📷 Scan QR code
              </button>
            )
          )}

          {!scanning && (
            <>
              <div className="field" style={{ marginTop: canScan ? 14 : 0 }}>
                <label className="label" htmlFor="tok">
                  {canScan ? "Or type the code from their card" : "Type the code from their card"}
                </label>
                <input
                  id="tok"
                  className="input"
                  placeholder="e.g. K7M2 9XPQ"
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value.toUpperCase())}
                  style={{ fontSize: 22, fontWeight: 750, letterSpacing: "0.16em", textAlign: "center" }}
                />
              </div>
            </>
          )}
          {!scanning && (
            <button className="btn btn-ghost" disabled={busy || !manualToken.trim()}
                    onClick={() => doScan(manualToken)}>
              {busy ? <><span className="spin" /> Checking…</> : "Look up"}
            </button>
          )}

          {err && <div className="err">{err}</div>}
        </div>
      )}

      {scanned && (
        <>
          <div className="card">
            <h2>{scanned.customer.name}</h2>
            <div className="stats" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="stat"><div className="v">{scanned.customer.pointsBalance}</div><div className="k">Points</div></div>
              <div className="stat"><div className="v">{scanned.customer.visitCount}</div><div className="k">Visits</div></div>
              <div className="stat"><div className="v">{Math.round(scanned.customer.totalSpend)}</div><div className="k">Spent</div></div>
            </div>
          </div>

          <div className="card">
            <h2>Enter the bill</h2>
            <form onSubmit={submitBill}>
              <div className="field">
                <label className="label" htmlFor="inv">Invoice number</label>
                <input id="inv" className="input" placeholder="e.g. INV-2291"
                       value={bill.invoiceNumber}
                       onChange={(e) => setBill({ ...bill, invoiceNumber: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="amt">Bill amount</label>
                <input id="amt" className="input" inputMode="decimal" placeholder="e.g. 120"
                       value={bill.amount}
                       onChange={(e) => setBill({ ...bill, amount: e.target.value })} />
              </div>

              {scanned.availableRewards.length > 0 && (
                <div className="field">
                  <label className="label" htmlFor="rw">
                    Apply a reward <span className="opt">(optional)</span>
                  </label>
                  <select id="rw" className="select" value={bill.redeemRewardId}
                          onChange={(e) => setBill({ ...bill, redeemRewardId: e.target.value })}>
                    <option value="">No reward</option>
                    {scanned.availableRewards.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.isPercent ? ` — ${r.value}% off` : r.value ? ` — ${r.value} off` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button className="btn" disabled={busy}>
                {busy ? <><span className="spin" /> Saving…</> : "Save visit"}
              </button>
            </form>
            {err && <div className="err">{err}</div>}
            <button className="btn btn-ghost" style={{ marginTop: 10 }}
                    onClick={() => { setScanned(null); setErr(""); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
