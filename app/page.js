"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "./base.js";
import { COUNTRIES, DEFAULT_COUNTRY } from "../lib/mobile.js";

const BRAND = process.env.NEXT_PUBLIC_APP_NAME || "Loyalty Club";

// Accepts the exact code ("07") or a bare number ("7") someone typed off the
// poster without the leading zero.
function matchBranch(list, raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  return (
    list.find((b) => b.code?.toUpperCase() === upper) ||
    (/^\d+$/.test(v) ? list.find((b) => Number(b.code) === Number(v)) : null) ||
    null
  );
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState("register"); // register | login
  const [stage, setStage] = useState("form"); // form | code
  const [branches, setBranches] = useState([]);
  const [f, setF] = useState({
    name: "", mobile: "", countryCode: DEFAULT_COUNTRY,
    email: "", birthday: "", branchId: "",
  });
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [branchCode, setBranchCode] = useState("");

  useEffect(() => {
    // The QR on a branch's counter poster links here as ?b=<code>, so the
    // branch is already known before the customer touches anything.
    try {
      const b = new URLSearchParams(window.location.search).get("b");
      if (b) setBranchCode(b);
    } catch {}
  }, []);

  useEffect(() => {
    fetch(apiUrl("/api/branches"))
      .then((r) => r.json())
      .then((d) => {
        setBranches(d.branches || []);
        if (d.branches?.length) setF((x) => ({ ...x, branchId: x.branchId || d.branches[0].id }));
      })
      .catch(() => {});
  }, []);

  const matchedBranch = matchBranch(branches, branchCode);
  useEffect(() => {
    if (matchedBranch) setF((x) => ({ ...x, branchId: matchedBranch.id }));
  }, [matchedBranch]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function sendCode(e) {
    e?.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(apiUrl("/api/auth/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, mode }),
      });
      const d = await r.json();
      if (!r.ok) {
        // Steer them to the other path rather than leaving them stuck.
        if (d.alreadyRegistered) setMode("login");
        if (d.notRegistered) setMode("register");
        throw new Error(d.error || "Something went wrong.");
      }
      setDevCode(d.devCode || "");
      setStage("code");
    } catch (e2) {
      setErr(String(e2.message || e2));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e?.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(apiUrl("/api/auth/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: f.mobile, countryCode: f.countryCode, code, mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      router.push("/card");
    } catch (e2) {
      setErr(String(e2.message || e2));
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="brandbar">
        <div className="brandmark">LC</div>
        <div>
          <div className="brandname">{BRAND}</div>
          <div className="brandsub">Every branch, one card</div>
        </div>
      </div>

      {stage === "form" ? (
        <div className="card">
          <h1>{mode === "register" ? "Join the club" : "Welcome back"}</h1>
          <p className="sub">
            {mode === "register"
              ? "Register once and get 10% off today. Your points work at every branch."
              : "Enter your mobile number and we will send you a code."}
          </p>

          <form onSubmit={sendCode}>
            {mode === "register" && (
              <div className="field">
                <label className="label" htmlFor="name">Full name</label>
                <input id="name" className="input" placeholder="e.g. Imran Sheikh"
                       value={f.name} onChange={set("name")} autoComplete="name" />
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="mobile">Mobile number</label>
              <div className="phone-row">
                <select
                  className="select cc"
                  aria-label="Country code"
                  value={f.countryCode}
                  onChange={set("countryCode")}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} +{c.code}
                    </option>
                  ))}
                </select>
                <input id="mobile" className="input" inputMode="tel" placeholder="50 123 4567"
                       value={f.mobile} onChange={set("mobile")} autoComplete="tel" />
              </div>
            </div>

            {mode === "register" && (
              <>
                <div className="field">
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" className="input" type="email" placeholder="you@example.com"
                         value={f.email} onChange={set("email")} autoComplete="email" />
                </div>

                <div className="field">
                  <label className="label" htmlFor="birthday">
                    Birthday <span className="opt">— for your birthday gift</span>
                  </label>
                  <input id="birthday" className="input" type="date"
                         value={f.birthday} onChange={set("birthday")} />
                </div>

                <div className="field">
                  <label className="label" htmlFor="branchCode">
                    Branch code <span className="opt">— from the code at your table</span>
                  </label>
                  <input id="branchCode" className="input" inputMode="numeric" placeholder="e.g. 1007" maxLength={4}
                         value={branchCode} onChange={(e) => setBranchCode(e.target.value)} />
                  {branchCode && (
                    matchedBranch
                      ? <div className="note">✓ {matchedBranch.name} — {matchedBranch.city}</div>
                      : <div className="err">Code not recognised — pick your branch below instead.</div>
                  )}
                </div>

                <div className="field">
                  <label className="label" htmlFor="branch">
                    {matchedBranch ? "Not your branch?" : "Or choose your branch"}
                  </label>
                  <select id="branch" className="select" value={f.branchId} onChange={set("branchId")}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} — {b.city}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <button className="btn" type="submit" disabled={busy}>
              {busy ? <><span className="spin" /> Sending…</> : "Send code"}
            </button>
          </form>

          {err && <div className="err">{err}</div>}

          <div className="linkrow">
            {mode === "register" ? (
              <>Already a member? <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setErr(""); }}>Sign in</a></>
            ) : (
              <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode("register"); setErr(""); }}>Register</a></>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <h1>Enter the code</h1>
          <p className="sub">We sent a 6-digit code to +{f.countryCode} {f.mobile}.</p>

          <form onSubmit={verify}>
            <div className="field">
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ fontSize: 28, fontWeight: 800, letterSpacing: "0.32em", textAlign: "center" }}
                autoFocus
              />
            </div>
            <button className="btn" type="submit" disabled={busy || code.length < 4}>
              {busy ? <><span className="spin" /> Checking…</> : "Confirm"}
            </button>
          </form>

          {devCode && (
            <div className="devnote">
              No SMS provider connected yet — your code is <strong>{devCode}</strong>
            </div>
          )}

          {err && <div className="err">{err}</div>}

          <div className="linkrow">
            <a href="#" onClick={(e) => { e.preventDefault(); setStage("form"); setCode(""); setErr(""); }}>
              Change number
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
