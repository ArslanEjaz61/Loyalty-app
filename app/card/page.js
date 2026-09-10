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
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "", birthday: "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

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

  const { customer, qr, rewards, transactions, offers, nextTargets, currency } = data;
  const available = rewards.filter((r) => r.status === "AVAILABLE");
  const past = rewards.filter((r) => r.status !== "AVAILABLE");

  function openEditor() {
    setProfile({
      name: customer.name || "",
      email: customer.email || "",
      birthday: customer.birthday ? String(customer.birthday).slice(0, 10) : "",
    });
    setProfileMsg(null);
    setEditing(true);
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const r = await fetch(apiUrl("/api/profile"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save your details.");
      setProfileMsg({ type: "ok", text: "Saved." });
      setEditing(false);
      load();
    } catch (e2) {
      setProfileMsg({ type: "err", text: String(e2.message || e2) });
    } finally {
      setProfileBusy(false);
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

      {offers?.length > 0 && (
        <div className="card">
          <h2>Offers for you</h2>
          {offers.map((o) => (
            <div key={o.id} className="reward-row">
              <div className="ic" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}>%</div>
              <div>
                <div className="nm">{o.name}</div>
                <div className="ds">
                  {o.description || (o.isPercent ? `${o.value}% off` : `${currency} ${o.value} off`)}
                  {o.everywhere ? " · all branches" : " · selected branches"}
                </div>
              </div>
              {o.endsAt && <span className="pill">till {new Date(o.endsAt).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Your details</h2>
        {!editing ? (
          <>
            <div className="tx-row">
              <div><div className="b">{customer.name}</div><div className="d">{customer.mobile}</div></div>
            </div>
            <div className="tx-row">
              <div><div className="b">Email</div><div className="d">{customer.email || "—"}</div></div>
            </div>
            <div className="tx-row">
              <div>
                <div className="b">Date of birth</div>
                <div className="d">
                  {customer.birthday ? new Date(customer.birthday).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
            <button className="btn-ghost sm" type="button" onClick={openEditor}>Edit details</button>
            {profileMsg?.type === "ok" && <div className="note">{profileMsg.text}</div>}
          </>
        ) : (
          <form onSubmit={saveProfile}>
            <div className="field">
              <label className="label" htmlFor="pname">Full name</label>
              <input id="pname" className="input" value={profile.name}
                     onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pemail">Email</label>
              <input id="pemail" className="input" type="email" value={profile.email}
                     onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pdob">
                Date of birth <span className="opt">— for your birthday gift</span>
              </label>
              <input id="pdob" className="input" type="date" value={profile.birthday}
                     onChange={(e) => setProfile((p) => ({ ...p, birthday: e.target.value }))} />
            </div>
            <button className="btn" type="submit" disabled={profileBusy}>
              {profileBusy ? <><span className="spin" /> Saving…</> : "Save"}
            </button>
            <button className="btn-ghost sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
            {profileMsg?.type === "err" && <div className="err">{profileMsg.text}</div>}
          </form>
        )}
        <p className="sub" style={{ marginTop: 12 }}>
          Points, visits and rewards are added by staff at the counter — they cannot be changed from here.
        </p>
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
