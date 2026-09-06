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
