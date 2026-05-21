import { useState, useEffect } from "react";
import { auth, googleProvider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, deleteDoc, updateDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp
} from "firebase/firestore";
import {
  registerSW, requestNotificationPermission,
  scheduleDailyCheck, syncItemsToDB, sendTestNotification
} from "./notifications";

const CATEGORIES = [
  { label: "Meat & Fish", emoji: "🥩" },
  { label: "Dairy", emoji: "🥛" },
  { label: "Veg & Salad", emoji: "🥦" },
  { label: "Bread & Bakery", emoji: "🍞" },
  { label: "Drinks", emoji: "🧃" },
  { label: "Eggs", emoji: "🥚" },
  { label: "Frozen", emoji: "🧊" },
  { label: "Other", emoji: "🫙" },
];

const emptyForm = { name: "", category: "Dairy", expiry: "", quantity: "", notes: "" };

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(dateStr); expiry.setHours(0,0,0,0);
  return Math.round((expiry - today) / 86400000);
}

function urgencyInfo(days) {
  if (days < 0) return { label: "EXPIRED", sublabel: `${Math.abs(days)} day${Math.abs(days)!==1?"s":""} ago`, color: "#6b7280", bg: "#1f2937", badge: "#374151", text: "#9ca3af" };
  if (days === 0) return { label: "USE TODAY", sublabel: "Today", color: "#ef4444", bg: "#2d1515", badge: "#ef4444", text: "#fff" };
  if (days <= 2) return { label: "USE SOON", sublabel: `${days} day${days!==1?"s":""} left`, color: "#f97316", bg: "#2d1a0e", badge: "#f97316", text: "#fff" };
  if (days <= 4) return { label: "FINE", sublabel: `${days} days left`, color: "#4ade80", bg: "#0f2318", badge: "#166534", text: "#4ade80" };
  return { label: "FINE", sublabel: `${days} days left`, color: "#4ade80", bg: "#0f2318", badge: "#166534", text: "#4ade80" };
}

function getCategoryEmoji(categoryLabel) {
  const cat = CATEGORIES.find(c => c.label === categoryLabel);
  return cat ? cat.emoji : "🫙";
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [view, setView] = useState("inventory");
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notifStatus, setNotifStatus] = useState("unknown");
  const [swReg, setSwReg] = useState(null);

  useEffect(() => {
    registerSW().then(reg => {
      if (reg) { setSwReg(reg); scheduleDailyCheck(reg); }
    });
    if ("Notification" in window) setNotifStatus(Notification.permission);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

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
    setTimeout(() => setToast(null), 3500);
  };

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (e.code === "auth/popup-blocked") {
        showToast("Popup blocked — please allow popups for this site", "error");
      } else {
        showToast("Sign-in failed. Please try again.", "error");
      }
    }
  };

  const handleSignOut = async () => { await signOut(auth); setItems([]); };

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifStatus(result);
    if (result === "granted") {
      await sendTestNotification();
      showToast("🔔 Reminders enabled!");
    } else {
      showToast("Notifications blocked in settings", "error");
    }
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setView("add");
  };

  const openEdit = (item) => {
    setForm({ name: item.name, category: item.category, expiry: item.expiry, quantity: item.quantity || "", notes: item.notes || "" });
    setEditingId(item.id);
    setSelectedItem(item);
    setView("add");
  };

  const openDetail = (item) => {
    setSelectedItem(item);
    setConfirmDelete(false);
    setView("detail");
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.expiry) { showToast("Please fill in name and expiry date", "error"); return; }
    setLoading(true);
    const itemData = {
      name: form.name.trim(),
      category: form.category,
      expiry: form.expiry,
      quantity: form.quantity,
      notes: form.notes,
      addedBy: user.displayName?.split(" ")[0] || user.email,
      createdAt: serverTimestamp()
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "items", editingId), itemData);
        showToast(`${form.name} updated ✓`);
      } else {
        await addDoc(collection(db, "items"), itemData);
        showToast(`${form.name} added ✓`);
      }
      setView("inventory");
      setForm(emptyForm);
      setEditingId(null);
    } catch { showToast("Something went wrong", "error"); }
    setLoading(false);
  };

  const handleMarkUsed = async (item) => {
    await deleteDoc(doc(db, "items", item.id));
    setView("inventory");
    showToast(`✅ ${item.name} used — great job!`);
  };

  const handleDelete = async (item) => {
    await deleteDoc(doc(db, "items", item.id));
    setView("inventory");
    showToast(`${item.name} removed`, "info");
  };

  const filtered = items.filter(item => {
    const d = daysUntil(item.expiry);
    if (filter === "Use Soon") return d >= 0 && d <= 2;
    if (filter === "Expired") return d < 0;
    if (filter === "Fine") return d > 2;
    return true;
  });

  const totalItems = items.length;
  const useSoon = items.filter(i => { const d = daysUntil(i.expiry); return d >= 0 && d <= 2; }).length;
  const expired = items.filter(i => daysUntil(i.expiry) < 0).length;

  if (authLoading) return (
    <div style={S.splash}>
      <div style={S.splashLogo}><span style={S.splashFresh}>Fresh</span><span style={S.splashWatch}>Watch</span></div>
    </div>
  );

  if (!user) return (
    <div style={S.loginBg}>
      <div style={S.loginOverlay} />
      <div style={S.loginContent}>
        <div style={S.loginIconWrap}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="12" y="28" width="40" height="28" rx="4" fill="#166534" opacity="0.8"/>
            <path d="M20 28 L20 20 Q20 12 28 10 Q32 9 32 14 Q32 9 36 10 Q44 12 44 20 L44 28" stroke="#4ade80" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="32" cy="20" r="3" fill="#4ade80"/>
            <path d="M26 38 L30 42 L38 34" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={S.loginTitle}><span style={S.greenText}>Fresh</span>Watch</div>
        <div style={S.loginTagline}>Track it. Use it. Waste less. 💚</div>
        <div style={S.loginSub}>Keep your kitchen fresh together.</div>
        <button style={S.googleBtn} onClick={handleSignIn}>
          <svg width="20" height="20" viewBox="0 0 18 18" style={{marginRight:12,flexShrink:0}}>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18z"/>
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
          </svg>
          Sign in with Google
        </button>
        <div style={S.loginPrivacy}>🛡️ Your data is private and shared securely with your household.</div>
      </div>
    </div>
  );

  // DETAIL VIEW
  if (view === "detail" && selectedItem) {
    const days = daysUntil(selectedItem.expiry);
    const urg = urgencyInfo(days);
    return (
      <div style={S.root}>
        {toast && <div style={{...S.toast,...(toast.type==="error"?S.toastErr:toast.type==="info"?S.toastInfo:{})}}>{toast.msg}</div>}
        <div style={S.detailHeader}>
          <button style={S.backBtn} onClick={() => setView("inventory")}>← Back</button>
          <div style={{width:40}} />
        </div>
        <div style={S.detailBody}>
          <div style={S.detailHero}>
            <div style={S.detailEmoji}>{getCategoryEmoji(selectedItem.category)}</div>
            <div style={S.detailName}>{selectedItem.name}</div>
            <div style={S.detailAddedBy}>Added by {selectedItem.addedBy}</div>
            {selectedItem.quantity && <div style={S.detailQuantity}>{selectedItem.quantity}</div>}
          </div>
          <div style={{...S.detailUrgBadge, background: urg.badge}}>
            <span style={{color: urg.text, fontWeight:700, fontSize:14}}>{urg.label}</span>
          </div>
          <div style={S.detailExpiry}>Expires {days === 0 ? "today" : days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`} · {selectedItem.expiry}</div>
          <div style={S.detailCard}>
            <div style={S.detailRow}><span style={S.detailLabel}>Category</span><span style={S.detailVal}>{getCategoryEmoji(selectedItem.category)} {selectedItem.category}</span></div>
            {selectedItem.quantity && <div style={S.detailRow}><span style={S.detailLabel}>Quantity</span><span style={S.detailVal}>{selectedItem.quantity}</span></div>}
            <div style={S.detailRow}><span style={S.detailLabel}>Expiry date</span><span style={S.detailVal}>{selectedItem.expiry}</span></div>
            {selectedItem.notes && <div style={{...S.detailRow, flexDirection:"column", gap:4}}><span style={S.detailLabel}>Notes</span><span style={{...S.detailVal, color:"#9ca3af"}}>{selectedItem.notes}</span></div>}
          </div>
          {!confirmDelete ? (<>
            <button style={S.usedBtn} onClick={() => handleMarkUsed(selectedItem)}>✓ Used it ✓<br/><span style={{fontSize:11,fontWeight:400,opacity:0.8}}>Remove from inventory</span></button>
            <button style={S.editBtn} onClick={() => openEdit(selectedItem)}>✏️ Edit item</button>
            <button style={S.deleteBtn} onClick={() => setConfirmDelete(true)}>🗑️ Delete item</button>
          </>) : (
            <div style={S.confirmBox}>
              <div style={S.confirmTitle}>Delete this item?</div>
              <div style={S.confirmSub}>This action cannot be undone.</div>
              <div style={S.confirmRow}>
                <button style={S.confirmCancel} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button style={S.confirmDelete} onClick={() => handleDelete(selectedItem)}>Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ADD / EDIT VIEW
  if (view === "add") return (
    <div style={S.root}>
      {toast && <div style={{...S.toast,...(toast.type==="error"?S.toastErr:toast.type==="info"?S.toastInfo:{})}}>{toast.msg}</div>}
      <div style={S.addHeader}>
        <button style={S.backBtn} onClick={() => setView("inventory")}>← Back</button>
        <div style={S.addHeaderTitle}>{editingId ? "Edit Item" : "Add Item"}</div>
        <div style={{width:60}} />
      </div>
      <div style={S.addBody}>
        <label style={S.label}>Item name</label>
        <input style={S.input} placeholder="e.g. Greek Yogurt" value={form.name}
          onChange={e => setForm(f=>({...f,name:e.target.value}))} />
        <label style={S.label}>Category</label>
        <div style={S.categoryGrid}>
          {CATEGORIES.map(c => (
            <button key={c.label} style={{...S.catBtn,...(form.category===c.label?S.catBtnActive:{})}}
              onClick={() => setForm(f=>({...f,category:c.label}))}>
              <span style={{fontSize:20}}>{c.emoji}</span>
              <span style={{fontSize:11,marginTop:2}}>{c.label}</span>
            </button>
          ))}
        </div>
        <label style={S.label}>Use by / Best before</label>
        <input style={S.input} type="date" value={form.expiry}
          onChange={e => setForm(f=>({...f,expiry:e.target.value}))} />
        <label style={S.label}>Quantity</label>
        <input style={S.input} placeholder="e.g. 500g, 1 Litre, 6 eggs" value={form.quantity}
          onChange={e => setForm(f=>({...f,quantity:e.target.value}))} />
        <label style={S.label}>Notes <span style={{color:"#6b7280",fontWeight:400}}>(optional)</span></label>
        <textarea style={S.textarea} placeholder="Any notes (brand, type, storage, etc.)" value={form.notes}
          onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={3} />
        <button style={{...S.saveBtn,opacity:loading?0.7:1}} onClick={handleSubmit} disabled={loading}>
          {loading ? "Saving…" : editingId ? "Save Changes" : "Save Item"}
        </button>
      </div>
    </div>
  );

  // STATS VIEW
  if (view === "stats") return (
    <div style={S.root}>
      {toast && <div style={{...S.toast,...(toast.type==="error"?S.toastErr:toast.type==="info"?S.toastInfo:{})}}>{toast.msg}</div>}
      <div style={S.addHeader}>
        <div style={{width:60}} />
        <div style={S.addHeaderTitle}>Stats</div>
        <div style={{width:60}} />
      </div>
      <div style={S.addBody}>
        <div style={S.statCard}><div style={S.statBig}>{totalItems}</div><div style={S.statLbl}>Total items in stock</div></div>
        <div style={{...S.statCard,background:"#2d1a0e"}}><div style={{...S.statBig,color:"#f97316"}}>{useSoon}</div><div style={S.statLbl}>Use soon (within 2 days)</div></div>
        <div style={{...S.statCard,background:"#2d1515"}}><div style={{...S.statBig,color:"#ef4444"}}>{expired}</div><div style={S.statLbl}>Expired items</div></div>
        <div style={{...S.statCard,background:"#0f2318"}}><div style={{...S.statBig,color:"#4ade80"}}>{totalItems - useSoon - expired}</div><div style={S.statLbl}>Items in good shape</div></div>
        {notifStatus !== "granted" && (
          <div style={S.notifBanner}>
            <div style={{fontWeight:700,fontSize:14,color:"#f0fdf4",marginBottom:4}}>🔔 Enable daily reminders</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>Get notified each morning about items expiring within 2 days</div>
            <button style={S.notifBtn} onClick={handleEnableNotifications}>Enable notifications</button>
          </div>
        )}
        {notifStatus === "granted" && (
          <div style={{...S.notifBanner,background:"#0f2318",borderColor:"#166534"}}>
            <div style={{fontSize:13,color:"#4ade80"}}>🔔 Daily reminders are on</div>
          </div>
        )}
      </div>
      <nav style={S.nav}>
        <button style={S.navBtn} onClick={() => setView("inventory")}><span style={S.navIcon}>🏠</span><span>Inventory</span></button>
        <button style={{...S.navBtn,...S.navBtnActive}}><span style={S.navIcon}>📊</span><span>Stats</span></button>
        <button style={S.navBtn} onClick={openAdd}><span style={S.navIcon}>➕</span><span>Add Item</span></button>
        <button style={S.navBtn} onClick={handleSignOut}><span style={S.navIcon}>👤</span><span>Sign out</span></button>
      </nav>
    </div>
  );

  // INVENTORY VIEW
  return (
    <div style={S.root}>
      {toast && <div style={{...S.toast,...(toast.type==="error"?S.toastErr:toast.type==="info"?S.toastInfo:{})}}>{toast.msg}</div>}
      <header style={S.header}>
        <div style={S.headerTop}>
          <div style={S.headerLeft}>
            <div style={S.headerTitle}><span style={S.greenText}>Fresh</span>Watch</div>
            <div style={S.headerSub}>Your inventory at a glance</div>
          </div>
          <div style={S.headerRight}>
            <div style={S.hiText}>Hi, {user.displayName?.split(" ")[0] || "there"}</div>
            <div style={S.avatarCircle}>{(user.displayName?.[0] || "U").toUpperCase()}</div>
          </div>
        </div>
        <div style={S.statsRow}>
          <div style={S.statPill}><div style={S.statPillNum}>{totalItems}</div><div style={S.statPillLabel}>Total items 🛒</div></div>
          <div style={{...S.statPill,...S.statPillWarn}}><div style={{...S.statPillNum,color:"#f97316"}}>{useSoon}</div><div style={S.statPillLabel}>Use soon ⏰</div></div>
          <div style={{...S.statPill,...S.statPillDanger}}><div style={{...S.statPillNum,color:"#ef4444"}}>{expired}</div><div style={S.statPillLabel}>Expired ⚠️</div></div>
        </div>
        <div style={S.filterTabs}>
          {["All","Use Soon","Expired","Fine"].map(f => (
            <button key={f} style={{...S.filterTab,...(filter===f?S.filterTabActive:{})}} onClick={() => setFilter(f)}>
              {f}
              {f==="Use Soon" && useSoon > 0 && <span style={S.filterDot} />}
              {f==="Expired" && expired > 0 && <span style={{...S.filterDot,background:"#ef4444"}} />}
            </button>
          ))}
        </div>
      </header>
      <main style={S.main}>
        {filtered.length === 0 ? (
          <div style={S.empty}>
            <div style={{fontSize:52,marginBottom:16}}>🥗</div>
            <div style={{fontSize:18,fontWeight:700,color:"#f0fdf4",marginBottom:8}}>
              {filter === "All" ? "Nothing logged yet" : `No ${filter.toLowerCase()} items`}
            </div>
            <div style={{fontSize:14,color:"#6b7280",marginBottom:24}}>
              {filter === "All" ? "Tap + to add items after your next shop" : "Check back later"}
            </div>
            {filter === "All" && <button style={S.emptyAddBtn} onClick={openAdd}>+ Add your first item</button>}
          </div>
        ) : (
          <div style={S.list}>
            {filtered.map(item => {
              const days = daysUntil(item.expiry);
              const urg = urgencyInfo(days);
              return (
                <div key={item.id} style={{...S.card,...(days<0?S.cardExpired:{})}} onClick={() => openDetail(item)}>
                  <div style={S.cardLeft}>
                    <div style={S.cardEmoji}>{getCategoryEmoji(item.category)}</div>
                    <div style={S.cardInfo}>
                      <div style={S.cardName}>{item.name}</div>
                      <div style={S.cardMeta}>👤 Added by {item.addedBy}{item.quantity ? ` · ${item.quantity}` : ""}</div>
                      {item.notes && <div style={S.cardNotes}>{item.notes}</div>}
                    </div>
                  </div>
                  <div style={S.cardRight}>
                    <div style={S.cardDate}>{item.expiry}</div>
                    <div style={{...S.urgBadge,background:urg.badge}}>
                      <span style={{color:urg.text,fontSize:10,fontWeight:700}}>{urg.label}</span>
                    </div>
                    <div style={{...S.daysLeft,color:urg.color}}>{urg.sublabel}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{height:90}} />
      </main>
      <button style={S.fab} onClick={openAdd}>+</button>
      <nav style={S.nav}>
        <button style={{...S.navBtn,...S.navBtnActive}}><span style={S.navIcon}>🏠</span><span>Inventory</span></button>
        <button style={S.navBtn} onClick={() => setView("stats")}><span style={S.navIcon}>📊</span><span>Stats</span></button>
        <button style={S.navBtn} onClick={openAdd}><span style={S.navIcon}>➕</span><span>Add Item</span></button>
        <button style={S.navBtn} onClick={handleSignOut}><span style={S.navIcon}>👤</span><span>Sign out</span></button>
      </nav>
    </div>
  );
}

const S = {
  splash:{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center"},
  splashLogo:{fontSize:36,fontWeight:800,letterSpacing:"-1px"},
  splashFresh:{color:"#4ade80"},splashWatch:{color:"#f0fdf4"},
  loginBg:{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:24,position:"relative",overflow:"hidden"},
  loginOverlay:{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 20%,rgba(74,222,128,0.06) 0%,transparent 60%)",pointerEvents:"none"},
  loginContent:{position:"relative",zIndex:1,textAlign:"center",maxWidth:340,width:"100%"},
  loginIconWrap:{marginBottom:20},
  loginTitle:{fontSize:40,fontWeight:800,color:"#f0fdf4",marginBottom:8,letterSpacing:"-1px"},
  greenText:{color:"#4ade80"},
  loginTagline:{fontSize:18,color:"#f0fdf4",fontWeight:600,marginBottom:8},
  loginSub:{fontSize:15,color:"#6b7280",marginBottom:36},
  googleBtn:{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",background:"#ffffff",color:"#111827",border:"none",borderRadius:12,padding:"14px 20px",fontSize:15,fontWeight:600,cursor:"pointer",marginBottom:20,boxShadow:"0 2px 8px rgba(0,0,0,0.3)"},
  loginPrivacy:{fontSize:12,color:"#4b5563",lineHeight:1.5},
  root:{minHeight:"100vh",background:"#0d1117",color:"#f0fdf4",fontFamily:"'Inter',-apple-system,sans-serif",paddingBottom:80},
  header:{background:"#0d1117",borderBottom:"1px solid #1f2937",padding:"16px 16px 0"},
  headerTop:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16},
  headerLeft:{},
  headerTitle:{fontSize:22,fontWeight:800,letterSpacing:"-0.5px",color:"#f0fdf4"},
  headerSub:{fontSize:12,color:"#6b7280",marginTop:2},
  headerRight:{display:"flex",alignItems:"center",gap:8},
  hiText:{fontSize:13,color:"#9ca3af"},
  avatarCircle:{width:34,height:34,borderRadius:"50%",background:"#166534",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#4ade80"},
  statsRow:{display:"flex",gap:10,marginBottom:16},
  statPill:{flex:1,background:"#161b22",border:"1px solid #1f2937",borderRadius:12,padding:"10px 8px",textAlign:"center"},
  statPillWarn:{background:"#1c1208",borderColor:"#2d1a0e"},
  statPillDanger:{background:"#160c0c",borderColor:"#2d1515"},
  statPillNum:{fontSize:22,fontWeight:800,color:"#f0fdf4"},
  statPillLabel:{fontSize:10,color:"#6b7280",marginTop:2},
  filterTabs:{display:"flex",gap:6,paddingBottom:12,overflowX:"auto"},
  filterTab:{background:"transparent",border:"1px solid #1f2937",borderRadius:20,padding:"6px 14px",fontSize:13,color:"#9ca3af",cursor:"pointer",whiteSpace:"nowrap",fontWeight:500,position:"relative",display:"flex",alignItems:"center",gap:5},
  filterTabActive:{background:"#166534",borderColor:"#166534",color:"#4ade80",fontWeight:600},
  filterDot:{width:6,height:6,borderRadius:"50%",background:"#f97316",display:"inline-block"},
  main:{padding:"12px 16px 0"},
  empty:{textAlign:"center",padding:"60px 20px"},
  emptyAddBtn:{background:"#166534",color:"#4ade80",border:"none",borderRadius:10,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:"pointer"},
  list:{display:"flex",flexDirection:"column",gap:10},
  card:{background:"#161b22",border:"1px solid #1f2937",borderRadius:14,padding:"14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",cursor:"pointer",gap:10},
  cardExpired:{opacity:0.6},
  cardLeft:{display:"flex",gap:12,alignItems:"flex-start",flex:1},
  cardEmoji:{fontSize:28,lineHeight:1,flexShrink:0},
  cardInfo:{flex:1},
  cardName:{fontSize:16,fontWeight:700,color:"#f0fdf4",marginBottom:3},
  cardMeta:{fontSize:11,color:"#6b7280",marginBottom:2},
  cardNotes:{fontSize:11,color:"#4b5563",fontStyle:"italic"},
  cardRight:{textAlign:"right",flexShrink:0},
  cardDate:{fontSize:11,color:"#6b7280",marginBottom:6},
  urgBadge:{borderRadius:6,padding:"3px 8px",marginBottom:4,display:"inline-block"},
  daysLeft:{fontSize:11,fontWeight:600},
  fab:{position:"fixed",bottom:76,right:20,width:52,height:52,borderRadius:"50%",background:"#16a34a",color:"#fff",border:"none",cursor:"pointer",fontSize:26,fontWeight:300,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(22,163,74,0.4)",zIndex:50},
  nav:{position:"fixed",bottom:0,left:0,right:0,background:"#0d1117",borderTop:"1px solid #1f2937",display:"flex",justifyContent:"space-around",padding:"10px 0 20px",zIndex:40},
  navBtn:{background:"transparent",border:"none",color:"#6b7280",fontSize:10,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontFamily:"inherit",fontWeight:500},
  navBtnActive:{color:"#4ade80"},
  navIcon:{fontSize:20},
  detailHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 16px 0"},
  backBtn:{background:"transparent",border:"none",color:"#4ade80",fontSize:15,cursor:"pointer",fontWeight:500,padding:4},
  detailBody:{padding:"20px 16px"},
  detailHero:{textAlign:"center",marginBottom:16},
  detailEmoji:{fontSize:64,marginBottom:8},
  detailName:{fontSize:26,fontWeight:800,color:"#f0fdf4",marginBottom:4},
  detailAddedBy:{fontSize:13,color:"#6b7280",marginBottom:4},
  detailQuantity:{fontSize:14,color:"#9ca3af"},
  detailUrgBadge:{borderRadius:8,padding:"6px 16px",display:"inline-block",marginBottom:8,textAlign:"center"},
  detailExpiry:{fontSize:13,color:"#6b7280",marginBottom:20,textAlign:"center"},
  detailCard:{background:"#161b22",border:"1px solid #1f2937",borderRadius:12,padding:"4px 0",marginBottom:20},
  detailRow:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"12px 16px",borderBottom:"1px solid #1f2937"},
  detailLabel:{fontSize:13,color:"#6b7280"},
  detailVal:{fontSize:13,color:"#f0fdf4",fontWeight:500,textAlign:"right",maxWidth:"60%"},
  usedBtn:{width:"100%",background:"#166534",color:"#fff",border:"none",borderRadius:12,padding:"16px",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:10,lineHeight:1.4},
  editBtn:{width:"100%",background:"#161b22",color:"#f0fdf4",border:"1px solid #1f2937",borderRadius:12,padding:"14px",fontSize:15,fontWeight:600,cursor:"pointer",marginBottom:10},
  deleteBtn:{width:"100%",background:"transparent",color:"#ef4444",border:"1px solid #2d1515",borderRadius:12,padding:"14px",fontSize:15,fontWeight:600,cursor:"pointer",marginBottom:20},
  confirmBox:{background:"#161b22",border:"1px solid #1f2937",borderRadius:14,padding:"24px",textAlign:"center"},
  confirmTitle:{fontSize:18,fontWeight:700,color:"#f0fdf4",marginBottom:8},
  confirmSub:{fontSize:13,color:"#6b7280",marginBottom:20},
  confirmRow:{display:"flex",gap:10},
  confirmCancel:{flex:1,background:"#1f2937",color:"#f0fdf4",border:"none",borderRadius:10,padding:"12px",fontSize:14,fontWeight:600,cursor:"pointer"},
  confirmDelete:{flex:1,background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"12px",fontSize:14,fontWeight:600,cursor:"pointer"},
  addHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 16px 0"},
  addHeaderTitle:{fontSize:18,fontWeight:700,color:"#f0fdf4"},
  addBody:{padding:"20px 16px"},
  label:{display:"block",fontSize:13,color:"#9ca3af",marginBottom:8,marginTop:16,fontWeight:500},
  input:{width:"100%",background:"#161b22",border:"1px solid #1f2937",borderRadius:10,padding:"13px 14px",color:"#f0fdf4",fontSize:15,boxSizing:"border-box",outline:"none"},
  textarea:{width:"100%",background:"#161b22",border:"1px solid #1f2937",borderRadius:10,padding:"13px 14px",color:"#f0fdf4",fontSize:14,boxSizing:"border-box",outline:"none",resize:"none",lineHeight:1.5},
  categoryGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:4},
  catBtn:{background:"#161b22",border:"1px solid #1f2937",borderRadius:10,padding:"10px 4px",display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer",color:"#9ca3af",fontFamily:"inherit"},
  catBtnActive:{background:"#0f2318",borderColor:"#166534",color:"#4ade80"},
  saveBtn:{width:"100%",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,padding:"16px",fontSize:16,fontWeight:700,cursor:"pointer",marginTop:24},
  statCard:{background:"#161b22",border:"1px solid #1f2937",borderRadius:14,padding:"20px",textAlign:"center",marginBottom:12},
  statBig:{fontSize:48,fontWeight:800,color:"#4ade80"},
  statLbl:{fontSize:14,color:"#6b7280",marginTop:4},
  notifBanner:{background:"#161b22",border:"1px solid #1f2937",borderRadius:12,padding:"16px",marginBottom:12},
  notifBtn:{width:"100%",background:"#166534",color:"#4ade80",border:"none",borderRadius:8,padding:"11px",fontSize:14,fontWeight:600,cursor:"pointer"},
  toast:{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:"#166534",color:"#fff",borderRadius:10,padding:"12px 20px",fontSize:14,fontWeight:600,zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",maxWidth:"90vw",textAlign:"center"},
  toastErr:{background:"#dc2626"},
  toastInfo:{background:"#1f2937",color:"#9ca3af"},
};
