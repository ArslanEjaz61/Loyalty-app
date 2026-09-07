"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "../base.js";

const BRAND = process.env.NEXT_PUBLIC_APP_NAME || "Loyalty Club";

function ago(iso) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Card() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [redeem, setRedeem] = useState({
    staffUsername: "", staffPin: "", invoiceNumber: "", amount: "", redeemRewardId: "",
  });
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/card"));
      if (r.status === 401) {
        router.push("/");
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load your card.");
      setData(d);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // The QR is short-lived, so refresh it a little before it lapses. Also picks
  // up points added at the till while the customer is still holding the phone.
  useEffect(() => {
    if (!data?.qr?.ttlSeconds) return undefined;
    const ms = Math.max((data.qr.ttlSeconds - 8) * 1000, 15000);
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [data?.qr?.ttlSeconds, load]);

  if (err) {
    return (
      <div className="shell">
        <div className="card"><div className="err">{err}</div></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shell">
        <div className="card"><div className="empty">Loading your card…</div></div>
      </div>
    );
  }

  const { customer, qr, rewards, transactions, nextTargets, currency } = data;
  const available = rewards.filter((r) => r.status === "AVAILABLE");
  const past = rewards.filter((r) => r.status !== "AVAILABLE");

  const setR = (k) => (e) => setRedeem((x) => ({ ...x, [k]: e.target.value }));

  async function submitRedeem(e) {
    e.preventDefault();
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      const r = await fetch(apiUrl("/api/redeem"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffUsername: redeem.staffUsername,
          staffPin: redeem.staffPin,
          invoiceNumber: redeem.invoiceNumber,
          amount: redeem.amount,
          redeemRewardId: redeem.redeemRewardId || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not record the visit.");
      setRedeemMsg({ type: "ok", text: `Visit recorded — +${d.transaction.pointsEarned} points` });
      setRedeem({ staffUsername: "", staffPin: "", invoiceNumber: "", amount: "", redeemRewardId: "" });
      load();
    } catch (e2) {
      setRedeemMsg({ type: "err", text: String(e2.message || e2) });
    } finally {
      setRedeemBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="brandbar">
        <div className="brandmark">LC</div>
        <div>
          <div className="brandname">{BRAND}</div>
          <div className="brandsub">
            {customer.homeBranch ? `${customer.homeBranch.name} · ${customer.homeBranch.city}` : "Member"}
          </div>
        </div>
      </div>

      <div className="loyalty">
        <div className="who">{customer.name}</div>
        <div className="since">
          Member since {new Date(customer.memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
        </div>
        <div className="qrbox">
          <img src={qr.image} alt="Your loyalty code" />
        </div>
        {/* Shown as text too — the staff camera is not always available, and
            reading eight characters aloud is faster than troubleshooting it. */}
        <div className="cardcode">{qr.code}</div>
        <div className="qrhint">Show the code at the counter · refreshes automatically</div>
      </div>

      <div className="card">
        <h2>For staff at the counter</h2>
        <p className="sub">Hand your phone over — staff enter their own code below to record this visit.</p>
        <form onSubmit={submitRedeem}>
          <div className="field">
            <label className="label" htmlFor="staffUsername">Staff username</label>
            <input id="staffUsername" className="input" value={redeem.staffUsername} onChange={setR("staffUsername")} autoComplete="off" />
          </div>
          <div className="field">
            <label className="label" htmlFor="staffPin">Staff PIN</label>
            <input id="staffPin" className="input" type="password" inputMode="numeric" value={redeem.staffPin} onChange={setR("staffPin")} autoComplete="off" />
          </div>
          <div className="field">
            <label className="label" htmlFor="invoiceNumber">Invoice number</label>
            <input id="invoiceNumber" className="input" placeholder="e.g. INV-2291" value={redeem.invoiceNumber} onChange={setR("invoiceNumber")} />
          </div>
          <div className="field">
            <label className="label" htmlFor="amount">Bill amount</label>
            <input id="amount" className="input" type="number" inputMode="decimal" placeholder="e.g. 120" value={redeem.amount} onChange={setR("amount")} />
          </div>
          {available.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="redeemRewardId">Apply a reward <span className="opt">(optional)</span></label>
              <select id="redeemRewardId" className="select" value={redeem.redeemRewardId} onChange={setR("redeemRewardId")}>
                <option value="">No reward</option>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} — {r.isPercent ? `${r.value}% off` : `${currency} ${r.value}`}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn" type="submit" disabled={redeemBusy}>
            {redeemBusy ? <><span className="spin" /> Validating…</> : "Validate & save visit"}
          </button>
        </form>
        {redeemMsg && (
          <div className={redeemMsg.type === "ok" ? "note" : "err"}>{redeemMsg.text}</div>
        )}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="v">{customer.pointsBalance}</div>
          <div className="k">Points</div>
        </div>
        <div className="stat">
          <div className="v">{customer.visitCount}</div>
          <div className="k">Visits</div>
        </div>
        <div className="stat">
          <div className="v">{Math.round(customer.totalSpend)}</div>
          <div className="k">{currency} spent</div>
        </div>
      </div>

      {nextTargets?.length > 0 && (
        <div className="card">
          <h2>Almost there</h2>
          {nextTargets.map((t, i) => (
            <div key={i} className="tx-row">
              <div><span className="b">{t.name}</span></div>
              <div className="p">
                {t.need} more {t.kind === "points" ? "points" : t.need === 1 ? "visit" : "visits"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Your rewards</h2>
        {available.length === 0 && past.length === 0 ? (
          <div className="empty">No rewards yet — they unlock as you visit.</div>
        ) : (
          <>
            {available.map((r) => (
              <div key={r.id} className="reward-row">
                <div className="ic">★</div>
                <div>
                  <div className="nm">{r.name}</div>
                  <div className="ds">{r.description}</div>
                </div>
                <span className="pill">Ready</span>
              </div>
            ))}
            {past.map((r) => (
              <div key={r.id} className="reward-row">
                <div className="ic" style={{ background: "var(--line)", color: "var(--ink-3)" }}>✓</div>
                <div>
                  <div className="nm" style={{ color: "var(--ink-3)" }}>{r.name}</div>
                  <div className="ds">
                    {r.status === "REDEEMED" ? `Used ${ago(r.redeemedAt)}` : "Expired"}
                  </div>
                </div>
                <span className="pill used">{r.status === "REDEEMED" ? "Used" : "Expired"}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>Recent visits</h2>
        {transactions.length === 0 ? (
          <div className="empty">Your first visit will appear here.</div>
        ) : (
          transactions.map((t) => (
            <div key={t.id} className="tx-row">
              <div>
                <div className="b">{t.branch}</div>
                <div className="d">{ago(t.createdAt)} · {currency} {t.amount}</div>
              </div>
              <div className="p">+{t.pointsEarned}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
