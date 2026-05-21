import { useState, useEffect } from "react";
import { auth, googleProvider, db } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, deleteDoc, updateDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp
} from "firebase/firestore";
import {
  registerSW, requestNotificationPermission,
  scheduleDailyCheck, syncItemsToDB, sendTestNotification
} from "./notifications";

const CATEGORIES = [
  "🥩 Meat & Fish", "🥛 Dairy", "🥦 Veg & Salad",
  "🍞 Bread & Bakery", "🧃 Drinks", "🥚 Eggs", "🧊 Frozen", "🫙 Other"
];

const emptyForm = { name: "", category: CATEGORIES[0], expiry: "", quantity: "", notes: "" };

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(dateStr); expiry.setHours(0,0,0,0);
  return Math.round((expiry - today) / 86400000);
}

function urgencyClass(days) {
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days <= 2) return "urgent";
  if (days <= 4) return "warning";
  return "safe";
}

function urgencyLabel(days) {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Use TODAY";
  if (days === 1) return "Use TOMORROW";
  return `${days} days left`;
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("expiry");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [notifStatus, setNotifStatus] = useState("unknown");
  const [swReg, setSwReg] = useState(null);

  // Register service worker on load
  useEffect(() => {
    registerSW().then(reg => {
      if (reg) {
        setSwReg(reg);
        scheduleDailyCheck(reg);
      }
    });
    if ("Notification" in window) {
      setNotifStatus(Notification.permission);
    }
  }, []);

  // Auth listener + handle redirect result on return from Google
  useEffect(() => {
    getRedirectResult(auth).catch(() => {});
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Firestore listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "items"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setItems(fetched);
      syncItemsToDB(fetched);
    });
    return unsub;
  }, [user]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifStatus(result);
    if (result === "granted") {
      const ok = await sendTestNotification();
      if (ok) showToast("🔔 Notifications enabled! You'll get a daily reminder.", "success");
    } else if (result === "denied") {
      showToast("Notifications blocked — enable them in your browser settings.", "error");
    }
  };

  const handleSignIn = async () => {
    try {
      if (isMobile()) {
        await signInWithRedirect(auth, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (e) {
      showToast("Sign-in failed. Please try again.", "error");
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setItems([]);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.expiry) {
      showToast("Please enter item name and expiry date", "error");
      return;
    }
    setLoading(true);
    const itemData = {
      name: form.name.trim(),
      category: form.category,
      expiry: form.expiry,
      quantity: form.quantity,
      notes: form.notes,
      addedBy: user.displayName || user.email,
      createdAt: serverTimestamp()
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "items", editingId), itemData);
        showToast(`${form.name} updated ✓`, "success");
      } else {
        await addDoc(collection(db, "items"), itemData);
        showToast(`${form.name} added ✓`, "success");
      }
      setForm(emptyForm);
      setShowForm(false);
      setEditingId(null);
    } catch (e) {
      showToast("Something went wrong. Please try again.", "error");
    }
    setLoading(false);
  };

  const handleDelete = async (id, name) => {
    await deleteDoc(doc(db, "items", id));
    setConfirmDelete(null);
    showToast(`${name} removed`, "info");
  };

  const handleMarkUsed = async (id, name) => {
    await deleteDoc(doc(db, "items", id));
    showToast("✅ Great — less food waste!", "success");
  };

  const handleEdit = (item) => {
    setForm({ name: item.name, category: item.category, expiry: item.expiry, quantity: item.quantity || "", notes: item.notes || "" });
    setEditingId(item.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = items
    .filter(item => {
      const d = daysUntil(item.expiry);
      if (filter === "urgent") return d >= 0 && d <= 2;
      if (filter === "expired") return d < 0;
      if (filter === "ok") return d > 2;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "expiry") return new Date(a.expiry) - new Date(b.expiry);
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return a.category.localeCompare(b.category);
    });

  const expiringSoon = items.filter(i => { const d = daysUntil(i.expiry); return d >= 0 && d <= 2; }).length;
  const expired = items.filter(i => daysUntil(i.expiry) < 0).length;

  if (authLoading) {
    return (
      <div style={S.loadScreen}>
        <div style={S.loadIcon}>🥦</div>
        <div style={S.loadText}>Food Waste Tracker</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={S.loginScreen}>
        <div style={S.loginCard}>
          <div style={S.loginIcon}>🥦</div>
          <h1 style={S.loginTitle}>Food Waste Tracker</h1>
          <p style={S.loginSub}>Log your shopping, get daily reminders before things expire, cut food waste.</p>
          <button style={S.googleBtn} onClick={handleSignIn}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight:10, flexShrink:0 }}>
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
              <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18z"/>
              <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
            </svg>
            Sign in with Google
          </button>
          <p style={S.loginNote}>Both Ryan and Robyn sign in with their own Google accounts. The shopping list is shared between you in real time.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      {toast && (
        <div style={{ ...S.toast, ...(toast.type==="error" ? S.toastErr : toast.type==="info" ? S.toastInfo : {}) }}>
          {toast.msg}
        </div>
      )}

      <header style={S.header}>
        <div style={S.headerInner}>
          <div>
            <div style={S.logo}>🥦 Food Waste Tracker</div>
            <div style={S.logoSub}>Hi {user.displayName?.split(" ")[0] || "there"} 👋</div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button style={S.addBtn} onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm); }}>
              {showForm ? "✕" : "+ Add"}
            </button>
            <button style={S.signOutBtn} onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
        <div style={S.statsBar}>
          <div style={S.stat}><span style={S.statNum}>{items.length}</span><span style={S.statLabel}>In stock</span></div>
          <div style={{ ...S.stat, ...S.statUrgent }}><span style={S.statNum}>{expiringSoon}</span><span style={S.statLabel}>Use soon</span></div>
          <div style={{ ...S.stat, ...S.statExpired }}><span style={{ ...S.statNum, color: expired > 0 ? "#ef9a9a" : "#7bc67e" }}>{expired}</span><span style={S.statLabel}>Expired</span></div>
        </div>
      </header>

      <main style={S.main}>

        {notifStatus !== "granted" && (
          <div style={S.notifBanner}>
            <div>
              <div style={S.notifTitle}>🔔 Enable daily reminders</div>
              <div style={S.notifSub}>Get a notification each morning when something is about to expire.</div>
            </div>
            <button style={S.notifBtn} onClick={handleEnableNotifications}>
              {notifStatus === "denied" ? "Blocked in settings" : "Enable"}
            </button>
          </div>
        )}

        {notifStatus === "granted" && (
          <div style={S.notifOn}>
            🔔 Daily reminders are on — you'll be notified each morning about items expiring within 2 days.
          </div>
        )}

        {showForm && (
          <div style={S.formCard}>
            <h2 style={S.formTitle}>{editingId ? "✏️ Edit Item" : "📦 Log New Item"}</h2>
            <div style={S.formGrid}>
              <div style={S.fieldFull}>
                <label style={S.label}>Item name *</label>
                <input style={S.input} placeholder="e.g. Chicken breast" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label style={S.label}>Category</label>
                <select style={S.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Use by / Best before *</label>
                <input style={S.input} type="date" value={form.expiry}
                  onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} />
              </div>
              <div>
                <label style={S.label}>Quantity</label>
                <input style={S.input} placeholder="e.g. 2 packs, 500g" value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div style={S.fieldFull}>
                <label style={S.label}>Notes (optional)</label>
                <input style={S.input} placeholder="e.g. Open pack — use first" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div style={S.formFooter}>
              <span style={S.calNote}>🔔 You'll be reminded 2 days before this expires</span>
              <button style={{ ...S.addBtn, background:"#388e3c", padding:"10px 20px", opacity: loading ? 0.7 : 1 }}
                onClick={handleSubmit} disabled={loading}>
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add to tracker"}
              </button>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div style={S.controls}>
            <div style={S.filters}>
              {[["all","All"],["urgent","⚠️ Soon"],["expired","❌ Expired"],["ok","✅ Fine"]].map(([v,l]) => (
                <button key={v} style={{ ...S.filterBtn, ...(filter===v ? S.filterActive : {}) }} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
            <select style={S.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="expiry">Sort: Expiry</option>
              <option value="name">Sort: Name</option>
              <option value="category">Sort: Category</option>
            </select>
          </div>
        )}

        {filtered.length === 0 && (
          <div style={S.empty}>
            {items.length === 0
              ? <><div style={S.emptyIcon}>🥗</div><p>Nothing logged yet.<br/>Hit <strong>+ Add</strong> after your next shop!</p></>
              : <><div style={S.emptyIcon}>🔍</div><p>No items match this filter.</p></>}
          </div>
        )}

        <div style={S.list}>
          {filtered.map(item => {
            const days = daysUntil(item.expiry);
            const urg = urgencyClass(days);
            const isDel = confirmDelete === item.id;
            return (
              <div key={item.id} style={{ ...S.card, ...S[`card_${urg}`] }}>
                <div style={S.cardTop}>
                  <div style={S.cardLeft}>
                    <span style={S.cardEmoji}>{item.category.split(" ")[0]}</span>
                    <div>
                      <div style={S.cardName}>{item.name}</div>
                      <div style={S.cardMeta}>
                        {item.category.split(" ").slice(1).join(" ")}
                        {item.quantity ? ` · ${item.quantity}` : ""}
                        {item.addedBy ? ` · ${item.addedBy.split(" ")[0]}` : ""}
                      </div>
                      {item.notes && <div style={S.cardNotes}>{item.notes}</div>}
                    </div>
                  </div>
                  <div style={S.cardRight}>
                    <div style={{ ...S.badge, ...S[`badge_${urg}`] }}>{urgencyLabel(days)}</div>
                    <div style={S.cardDate}>{item.expiry}</div>
                  </div>
                </div>
                {isDel ? (
                  <div style={S.confirmRow}>
                    <span style={S.confirmText}>Remove this item?</span>
                    <button style={S.btnDanger} onClick={() => handleDelete(item.id, item.name)}>Yes, remove</button>
                    <button style={S.btnGhost} onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={S.cardActions}>
                    <button style={S.btnUsed} onClick={() => handleMarkUsed(item.id, item.name)}>✓ Used it</button>
                    <button style={S.btnEdit} onClick={() => handleEdit(item)}>Edit</button>
                    <button style={S.btnRemove} onClick={() => setConfirmDelete(item.id)}>✕</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

const S = {
  root: { minHeight:"100vh", background:"#0f1a12", color:"#e8f5e9", fontFamily:"'DM Sans',sans-serif" },
  loadScreen: { minHeight:"100vh", background:"#0f1a12", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 },
  loadIcon: { fontSize:56 },
  loadText: { fontSize:20, fontWeight:700, color:"#7bc67e" },
  loginScreen: { minHeight:"100vh", background:"#0f1a12", display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
  loginCard: { background:"#1a2e1d", border:"1px solid #2a3d2d", borderRadius:20, padding:"40px 28px", maxWidth:380, width:"100%", textAlign:"center" },
  loginIcon: { fontSize:52, marginBottom:12 },
  loginTitle: { margin:"0 0 10px", fontSize:24, fontWeight:700, color:"#a5d6a7" },
  loginSub: { color:"#5a7a5d", fontSize:14, lineHeight:1.6, margin:"0 0 28px" },
  googleBtn: { display:"flex", alignItems:"center", justifyContent:"center", width:"100%", background:"#fff", color:"#333", border:"none", borderRadius:10, padding:"12px 20px", fontSize:15, fontWeight:600, cursor:"pointer", marginBottom:20 },
  loginNote: { fontSize:12, color:"#3d5c40", lineHeight:1.5, margin:0 },
  header: { background:"linear-gradient(135deg,#1a2e1d,#0f1a12)", borderBottom:"1px solid #2a3d2d" },
  headerInner: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 16px 12px" },
  logo: { fontSize:18, fontWeight:700, color:"#7bc67e" },
  logoSub: { fontSize:11, color:"#5a7a5d", marginTop:2 },
  addBtn: { background:"#4caf50", color:"#fff", border:"none", borderRadius:10, padding:"9px 16px", fontSize:14, fontWeight:600, cursor:"pointer" },
  signOutBtn: { background:"transparent", color:"#5a7a5d", border:"1px solid #2a3d2d", borderRadius:10, padding:"8px 12px", fontSize:12, cursor:"pointer" },
  statsBar: { display:"flex", borderTop:"1px solid #2a3d2d" },
  stat: { flex:1, textAlign:"center", padding:"10px 0", borderRight:"1px solid #2a3d2d" },
  statUrgent: { background:"rgba(255,152,0,0.07)" },
  statExpired: { background:"rgba(244,67,54,0.07)" },
  statNum: { display:"block", fontSize:20, fontWeight:700, color:"#7bc67e" },
  statLabel: { fontSize:10, color:"#5a7a5d", textTransform:"uppercase", letterSpacing:1 },
  main: { padding:16 },
  notifBanner: { background:"#1a2e1d", border:"1px solid #2a4a2d", borderRadius:12, padding:"14px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" },
  notifTitle: { fontWeight:700, fontSize:14, color:"#a5d6a7", marginBottom:3 },
  notifSub: { fontSize:12, color:"#5a7a5d", lineHeight:1.4 },
  notifBtn: { background:"#4caf50", color:"#fff", border:"none", borderRadius:8, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", flexShrink:0 },
  notifOn: { background:"rgba(76,175,80,0.08)", border:"1px solid rgba(76,175,80,0.2)", borderRadius:10, padding:"10px 14px", marginBottom:12, fontSize:12, color:"#81c784" },
  formCard: { background:"#1a2e1d", border:"1px solid #2a3d2d", borderRadius:16, padding:20, marginBottom:16 },
  formTitle: { margin:"0 0 12px", fontSize:16, fontWeight:700, color:"#a5d6a7" },
  formGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 },
  fieldFull: { gridColumn:"1/-1" },
  label: { display:"block", fontSize:11, color:"#5a7a5d", marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 },
  input: { width:"100%", background:"#0f1a12", border:"1px solid #2a3d2d", borderRadius:8, padding:"10px 12px", color:"#e8f5e9", fontSize:14, boxSizing:"border-box" },
  formFooter: { marginTop:14, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 },
  calNote: { fontSize:11, color:"#5a7a5d", flex:1 },
  controls: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 },
  filters: { display:"flex", gap:6, flexWrap:"wrap" },
  filterBtn: { background:"#1a2e1d", border:"1px solid #2a3d2d", borderRadius:20, padding:"5px 11px", fontSize:12, color:"#7bc67e", cursor:"pointer" },
  filterActive: { background:"#4caf50", borderColor:"#4caf50", color:"#fff" },
  sortSelect: { background:"#1a2e1d", border:"1px solid #2a3d2d", borderRadius:8, padding:"5px 10px", color:"#a5d6a7", fontSize:12 },
  empty: { textAlign:"center", padding:"60px 20px", color:"#5a7a5d", lineHeight:1.7 },
  emptyIcon: { fontSize:48, marginBottom:12 },
  list: { display:"flex", flexDirection:"column", gap:10 },
  card: { background:"#1a2e1d", borderRadius:14, padding:"14px 16px", borderLeft:"3px solid #2a3d2d", border:"1px solid #2a3d2d" },
  card_safe: { borderLeftColor:"#4caf50", borderLeftWidth:3 },
  card_warning: { borderLeftColor:"#ff9800", borderLeftWidth:3, background:"#1e2a18" },
  card_urgent: { borderLeftColor:"#f44336", borderLeftWidth:3, background:"#261e1a" },
  card_today: { borderLeftColor:"#f44336", borderLeftWidth:3, background:"#2a1a1a" },
  card_expired: { borderLeftColor:"#616161", borderLeftWidth:3, background:"#1a1a1a", opacity:0.7 },
  cardTop: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 },
  cardLeft: { display:"flex", gap:12, alignItems:"flex-start" },
  cardEmoji: { fontSize:24, lineHeight:1 },
  cardName: { fontWeight:700, fontSize:15, color:"#e8f5e9" },
  cardMeta: { fontSize:11, color:"#5a7a5d", marginTop:2 },
  cardNotes: { fontSize:11, color:"#7a9a7d", marginTop:3, fontStyle:"italic" },
  cardRight: { textAlign:"right" },
  badge: { display:"inline-block", borderRadius:20, padding:"3px 9px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 },
  badge_safe: { background:"rgba(76,175,80,0.15)", color:"#81c784" },
  badge_warning: { background:"rgba(255,152,0,0.2)", color:"#ffb74d" },
  badge_urgent: { background:"rgba(244,67,54,0.2)", color:"#ef9a9a" },
  badge_today: { background:"rgba(244,67,54,0.3)", color:"#f44336" },
  badge_expired: { background:"rgba(97,97,97,0.2)", color:"#9e9e9e" },
  cardDate: { fontSize:11, color:"#5a7a5d", marginTop:4 },
  cardActions: { display:"flex", gap:8 },
  btnUsed: { background:"rgba(76,175,80,0.15)", border:"1px solid rgba(76,175,80,0.3)", borderRadius:8, color:"#81c784", padding:"6px 12px", fontSize:12, cursor:"pointer", fontWeight:600 },
  btnEdit: { background:"rgba(255,255,255,0.05)", border:"1px solid #2a3d2d", borderRadius:8, color:"#a5d6a7", padding:"6px 12px", fontSize:12, cursor:"pointer" },
  btnRemove: { background:"transparent", border:"none", color:"#5a7a5d", padding:"6px 8px", fontSize:14, cursor:"pointer", marginLeft:"auto" },
  confirmRow: { display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" },
  confirmText: { fontSize:13, color:"#ef9a9a", flex:1 },
  btnDanger: { background:"rgba(244,67,54,0.2)", border:"1px solid rgba(244,67,54,0.4)", borderRadius:8, color:"#ef9a9a", padding:"6px 12px", fontSize:12, cursor:"pointer" },
  btnGhost: { background:"transparent", border:"1px solid #2a3d2d", borderRadius:8, color:"#5a7a5d", padding:"6px 12px", fontSize:12, cursor:"pointer" },
  toast: { position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#2e7d32", color:"#fff", borderRadius:10, padding:"12px 20px", fontSize:14, fontWeight:600, zIndex:999, boxShadow:"0 4px 20px rgba(0,0,0,0.4)", maxWidth:"90vw", textAlign:"center" },
  toastErr: { background:"#c62828" },
  toastInfo: { background:"#1a5276" },
};
