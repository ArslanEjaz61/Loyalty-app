"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../base.js";

/**
 * Management dashboard. Same login as the till, but cashiers are turned away —
 * a branch manager sees only their branch, company admins see everything.
 */

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

function money(cur, n) {
  return `${cur} ${Number(n || 0).toLocaleString()}`;
}

export default function Admin() {
  const [session, setSession] = useState(null);
  const [login, setLogin] = useState({ username: "", pin: "" });
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // customers tab
  const [cust, setCust] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  // audit tab
  const [audit, setAudit] = useState(null);

  // offers tab
  const [offers, setOffers] = useState(null);
  const [newOffer, setNewOffer] = useState({
    name: "", description: "", value: "", isPercent: true, branchIds: [], startsAt: "", endsAt: "",
  });
  const [offerMsg, setOfferMsg] = useState(null);

  const loadOverview = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(apiUrl("/api/admin/overview"));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load.");
      setData(d);
      setSession(d.scope);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const r = await fetch(
        apiUrl(`/api/admin/customers?q=${encodeURIComponent(q)}&page=${page}&filter=${filter}`)
      );
      const d = await r.json();
      if (r.ok) setCust(d);
    } catch { /* keep last good */ }
  }, [q, page, filter]);

  const loadAudit = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/admin/audit"));
      const d = await r.json();
      if (r.ok) setAudit(d);
    } catch { /* keep last good */ }
  }, []);

  const loadOffers = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/admin/offers"));
      const d = await r.json();
      if (r.ok) setOffers(d);
    } catch { /* keep last good */ }
  }, []);

  // Try the session that may already exist from the till screen.
  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (session && tab === "customers") loadCustomers();
    if (session && tab === "audit") loadAudit();
    if (session && tab === "offers") loadOffers();
  }, [session, tab, loadCustomers, loadAudit, loadOffers]);

  async function createOffer(e) {
    e.preventDefault();
    setBusy(true); setOfferMsg(null);
    try {
      const r = await fetch(apiUrl("/api/admin/offers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOffer),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not create the offer.");
      setOfferMsg({ type: "ok", text: "Offer created." });
      setNewOffer({ name: "", description: "", value: "", isPercent: true, branchIds: [], startsAt: "", endsAt: "" });
      loadOffers();
    } catch (e2) {
      setOfferMsg({ type: "err", text: String(e2.message || e2) });
    } finally { setBusy(false); }
  }

  async function toggleOffer(id, isActive) {
    try {
      const r = await fetch(apiUrl("/api/admin/offers"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive }),
      });
      if (r.ok) loadOffers();
    } catch { /* leave the list as it was */ }
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
      if (d.staff.role === "CASHIER") {
        throw new Error("Cashier accounts cannot open the dashboard.");
      }
      await loadOverview();
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  }

  // ---------- signed out
  if (!session) {
    return (
      <div className="shell">
        <div className="brandbar">
          <div className="brandmark">AD</div>
          <div>
            <div className="brandname">Management</div>
            <div className="brandsub">Dashboard</div>
          </div>
        </div>
        <div className="card">
          <h1>Sign in</h1>
          <form onSubmit={doLogin}>
            <div className="field">
              <label className="label" htmlFor="u">Username</label>
              <input id="u" className="input" autoComplete="username" value={login.username}
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

  if (!data) {
    return <div className="shell-wide"><div className="card"><div className="empty">Loading…</div></div></div>;
  }

  const k = data.kpis;
  const cur = data.currency;

  return (
    <div className="shell-wide">
      <div className="brandbar">
        <div className="brandmark">AD</div>
        <div>
          <div className="brandname">Management dashboard</div>
          <div className="brandsub">
            {data.scope.allBranches ? "All branches" : "Single branch"} · {data.scope.role.replace("_", " ").toLowerCase()}
          </div>
        </div>
      </div>

      <div className="tabs">
        {["overview", "customers", "offers", "staff", "audit"].map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); setPage(1); }}>
            {t}
          </button>
        ))}
      </div>

      {err && <div className="err" style={{ marginBottom: 14 }}>{err}</div>}

      {/* ---------------- overview ---------------- */}
      {tab === "overview" && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{k.totalCustomers}</div><div className="k">Customers</div></div>
            <div className="kpi"><div className="v">{k.newLast30}</div><div className="k">New in 30 days</div></div>
            <div className="kpi"><div className="v">{k.totalVisits}</div><div className="k">Visits</div></div>
            <div className="kpi"><div className="v">{money(cur, k.totalRevenue)}</div><div className="k">Tracked revenue</div></div>
            <div className="kpi"><div className="v">{money(cur, k.avgTransaction)}</div><div className="k">Average bill</div></div>
            <div className="kpi"><div className="v">{k.returnRate}%</div><div className="k">Came back again</div></div>
            <div className="kpi"><div className="v">{k.activeCustomers}</div><div className="k">Active (30 days)</div></div>
            <div className="kpi"><div className="v">{k.inactiveCustomers}</div><div className="k">Inactive (60+ days)</div></div>
            <div className="kpi"><div className="v">{k.pointsIssued}</div><div className="k">Points issued</div></div>
            <div className="kpi"><div className="v">{k.pointsRedeemed}</div><div className="k">Points redeemed</div></div>
            <div className="kpi"><div className="v">{k.rewardsRedeemed}/{k.rewardsIssued}</div><div className="k">Rewards used</div></div>
            <div className="kpi"><div className="v">{money(cur, k.discountGiven)}</div><div className="k">Discounts given</div></div>
          </div>

          <div className="card">
            <h2>Branch performance</h2>
            {data.branchPerformance.length === 0 ? (
              <div className="empty">No branches yet.</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Branch</th><th>City</th>
                      <th style={{ textAlign: "right" }}>Visits</th>
                      <th style={{ textAlign: "right" }}>Revenue</th>
                      <th style={{ textAlign: "right" }}>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.branchPerformance.map((b) => (
                      <tr key={b.id}>
                        <td className="strong">{b.name}</td>
                        <td>{b.city}</td>
                        <td className="num">{b.visits}</td>
                        <td className="num">{money(cur, b.revenue)}</td>
                        <td className="num">{b.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="two-col">
            <div className="card">
              <h2>Most used rewards</h2>
              {data.topRewards.length === 0 ? (
                <div className="empty">No rewards issued yet.</div>
              ) : data.topRewards.map((r) => (
                <div key={r.name} className="tx-row">
                  <div className="strong">{r.name}</div>
                  <div className="p">{r.count}</div>
                </div>
              ))}
            </div>

            <div className="card">
              <h2>Birthdays this month</h2>
              {data.birthdays.length === 0 ? (
                <div className="empty">Nobody this month.</div>
              ) : data.birthdays.map((b) => (
                <div key={b.mobile} className="tx-row">
                  <div><span className="strong">{b.name}</span><div className="d">+{b.mobile}</div></div>
                  <div className="p">day {b.day}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Latest transactions</h2>
            {data.recentTransactions.length === 0 ? (
              <div className="empty">No transactions yet.</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Branch</th><th>Staff</th><th>Invoice</th>
                      <th style={{ textAlign: "right" }}>Bill</th>
                      <th style={{ textAlign: "right" }}>Points</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentTransactions.map((t) => (
                      <tr key={t.id}>
                        <td className="strong">{t.customer}</td>
                        <td>{t.branch}</td>
                        <td>{t.staff}</td>
                        <td>{t.invoiceNumber}</td>
                        <td className="num">{money(cur, t.amount)}</td>
                        <td className="num">+{t.points}</td>
                        <td>{ago(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------- customers ---------------- */}
      {tab === "customers" && (
        <div className="card">
          <h2>Customer database</h2>
          <div className="toolbar">
            <input
              className="input"
              placeholder="Search name, mobile or email…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
            <select className="select" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
              <option value="all">All customers</option>
              <option value="inactive">Inactive (60+ days)</option>
              <option value="birthdays">Birthday this month</option>
            </select>
          </div>

          {!cust ? (
            <div className="empty">Loading…</div>
          ) : cust.customers.length === 0 ? (
            <div className="empty">No customers found.</div>
          ) : (
            <>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th>Mobile</th><th>Email</th><th>Home branch</th>
                      <th style={{ textAlign: "right" }}>Points</th>
                      <th style={{ textAlign: "right" }}>Visits</th>
                      <th style={{ textAlign: "right" }}>Spend</th>
                      <th>Last visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cust.customers.map((c) => (
                      <tr key={c.id}>
                        <td className="strong">{c.name}</td>
                        <td>+{c.mobile}</td>
                        <td>{c.email || "—"}</td>
                        <td>{c.branch}</td>
                        <td className="num">{c.points}</td>
                        <td className="num">{c.visits}</td>
                        <td className="num">{money(cur, c.spend)}</td>
                        <td>{ago(c.lastVisitAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button className="btn-ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span>Page {cust.page} of {cust.pages} · {cust.total} total</span>
                <button className="btn-ghost sm" disabled={page >= cust.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- staff ---------------- */}
      {/* ---------------- offers ---------------- */}
      {tab === "offers" && (
        <>
          {offers?.canEdit && (
            <div className="card">
              <h2>New offer</h2>
              <form onSubmit={createOffer}>
                <div className="two-col">
                  <div className="field">
                    <label className="label" htmlFor="oname">Name</label>
                    <input id="oname" className="input" placeholder="e.g. Weekend 20% off"
                           value={newOffer.name}
                           onChange={(e) => setNewOffer((o) => ({ ...o, name: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="oval">Discount</label>
                    <div className="phone-row">
                      <select className="select cc" value={newOffer.isPercent ? "pct" : "amt"}
                              onChange={(e) => setNewOffer((o) => ({ ...o, isPercent: e.target.value === "pct" }))}>
                        <option value="pct">%</option>
                        <option value="amt">AED</option>
                      </select>
                      <input id="oval" className="input" type="number" inputMode="decimal" placeholder="20"
                             value={newOffer.value}
                             onChange={(e) => setNewOffer((o) => ({ ...o, value: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label className="label" htmlFor="odesc">Description <span className="opt">(optional)</span></label>
                  <input id="odesc" className="input" placeholder="What the customer sees"
                         value={newOffer.description}
                         onChange={(e) => setNewOffer((o) => ({ ...o, description: e.target.value }))} />
                </div>

                <div className="two-col">
                  <div className="field">
                    <label className="label" htmlFor="ostart">Starts <span className="opt">(optional)</span></label>
                    <input id="ostart" className="input" type="date" value={newOffer.startsAt}
                           onChange={(e) => setNewOffer((o) => ({ ...o, startsAt: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="oend">Ends <span className="opt">(optional)</span></label>
                    <input id="oend" className="input" type="date" value={newOffer.endsAt}
                           onChange={(e) => setNewOffer((o) => ({ ...o, endsAt: e.target.value }))} />
                  </div>
                </div>

                <div className="field">
                  <label className="label">
                    Branches <span className="opt">— select none to run it everywhere</span>
                  </label>
                  <div className="tablewrap" style={{ maxHeight: 180, overflowY: "auto" }}>
                    {offers.branches.map((b) => (
                      <label key={b.id} className="tx-row" style={{ cursor: "pointer" }}>
                        <div>
                          <input type="checkbox" style={{ marginRight: 8 }}
                                 checked={newOffer.branchIds.includes(b.id)}
                                 onChange={(e) => setNewOffer((o) => ({
                                   ...o,
                                   branchIds: e.target.checked
                                     ? [...o.branchIds, b.id]
                                     : o.branchIds.filter((x) => x !== b.id),
                                 }))} />
                          <span className="b">{b.code} · {b.name}</span>
                          <span className="d"> {b.city}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <button className="btn" type="submit" disabled={busy}>
                  {busy ? <><span className="spin" /> Creating…</> : "Create offer"}
                </button>
                {offerMsg && <div className={offerMsg.type === "ok" ? "note" : "err"}>{offerMsg.text}</div>}
              </form>
            </div>
          )}

          <div className="card">
            <h2>Offers &amp; campaigns</h2>
            {!offers ? (
              <div className="empty">Loading…</div>
            ) : offers.offers.length === 0 ? (
              <div className="empty">No offers yet.</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Offer</th><th>Discount</th><th>Where</th><th>Runs</th><th>Status</th>
                      {offers.canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {offers.offers.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <div className="b">{o.name}</div>
                          {o.description && <div className="d">{o.description}</div>}
                        </td>
                        <td>{o.isPercent ? `${o.value}%` : `AED ${o.value}`}</td>
                        <td>{o.branches.length === 0 ? "All branches" : `${o.branches.length} branch${o.branches.length > 1 ? "es" : ""}`}</td>
                        <td>
                          {o.startsAt ? new Date(o.startsAt).toLocaleDateString() : "—"}
                          {" → "}
                          {o.endsAt ? new Date(o.endsAt).toLocaleDateString() : "—"}
                        </td>
                        <td><span className={`chip ${o.isLive ? "" : "off"}`}>{o.isLive ? "Live" : o.isActive ? "Scheduled" : "Paused"}</span></td>
                        {offers.canEdit && (
                          <td>
                            <button className="btn-ghost sm" onClick={() => toggleOffer(o.id, !o.isActive)}>
                              {o.isActive ? "Pause" : "Resume"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "staff" && (
        <div className="card">
          <h2>Staff</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th><th>Last signed in</th></tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{s.name}</td>
                    <td>{s.username}</td>
                    <td><span className="chip">{s.role.replace("_", " ").toLowerCase()}</span></td>
                    <td>{s.branch}</td>
                    <td>{ago(s.lastLogin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- audit ---------------- */}
      {tab === "audit" && (
        <div className="card">
          <h2>Audit trail</h2>
          {!audit ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              {audit.duplicatesBlocked > 0 && (
                <div className="note" style={{ marginBottom: 12 }}>
                  {audit.duplicatesBlocked} duplicate invoice{audit.duplicatesBlocked === 1 ? "" : "s"} blocked.
                </div>
              )}
              {audit.entries.length === 0 ? (
                <div className="empty">Nothing recorded yet.</div>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Action</th><th>By</th><th>Details</th><th>When</th></tr></thead>
                    <tbody>
                      {audit.entries.map((a) => (
                        <tr key={a.id}>
                          <td className="strong">{a.action}</td>
                          <td>{a.staff}</td>
                          <td className="mono">
                            {a.metadata ? JSON.stringify(a.metadata).slice(0, 90) : "—"}
                          </td>
                          <td>{ago(a.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
