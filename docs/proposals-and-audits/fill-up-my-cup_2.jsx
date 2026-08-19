import React, { useState, useEffect, useRef, useCallback } from "react";

/* Error boundary — if any child crashes, show the real message
   instead of a blank screen, so problems are diagnosable. */
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{
          fontFamily: "-apple-system,sans-serif", color: "#fff",
          background: "linear-gradient(170deg,#2B3568,#0E1130)",
          minHeight: "100vh", padding: "40px 24px", boxSizing: "border-box",
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Something broke while rendering</div>
          <div style={{
            fontFamily: "monospace", fontSize: 13, lineHeight: 1.5,
            background: "rgba(255,255,255,.08)", padding: 14, borderRadius: 12,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{String(this.state.err && this.state.err.stack || this.state.err)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}

/* ============================================================
   FILL UP MY CUP  ·  v4 — "Glassy & Tactile"
   - Jewel-glass cup: refraction, glow, depth, condensation
   - Coach with memory: morning hello, patterns, reflection
   - Insight: weekly review, stats, records
   - Body-double focus sessions; weighted pour + sound + haptic
   - Plan = List OR a draggable Timeline (timing optional per task)
   - Inbox -> Coach triage -> Plan -> finish -> cup fills
   - Foam head past 100%, then a 2nd cup; dailies; midnight reset
   - Onboarding, themes, auto dark. Persists via window.storage.
   ============================================================ */

const STORE_KEY = "fillcup:v4";
const CUP_ML = 470, FOAM_MAX = 25;
const DAY_START = 6, DAY_END = 24, HOUR_PX = 56;
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const monthKey = (k) => k.slice(0, 7);
const fmtHour = (h) => { const p = h >= 12 && h < 24 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh} ${p}`; };
const fmtMin = (m) => { let h = Math.floor(m / 60); const mm = m % 60; const p = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, "0")} ${p}`; };

const DRINK = {
  beer:     { name: "Beer",     lo: "#C9871F", hi: "#FBD06A", foam: "#FCF3D8", glow: "#FFB347", fizz: true,  emoji: "🍺" },
  coffee:   { name: "Coffee",   lo: "#4A2C18", hi: "#8A5A33", foam: "#E6D2BB", glow: "#9A6038", fizz: false, emoji: "☕️" },
  matcha:   { name: "Matcha",   lo: "#5C8C2A", hi: "#A6D45F", foam: "#E8F0D2", glow: "#86C247", fizz: false, emoji: "🍵" },
  smoothie: { name: "Smoothie", lo: "#B83A63", hi: "#F587AC", foam: "#FBDFE8", glow: "#FF6FA0", fizz: false, emoji: "🥤" },
  water:    { name: "Water",    lo: "#2E8FB8", hi: "#7FD6F0", foam: "#DDEFF6", glow: "#5EC6EC", fizz: true,  emoji: "💧" },
  cocoa:    { name: "Cocoa",    lo: "#5A3326", hi: "#9A6450", foam: "#F0E0D4", glow: "#A06848", fizz: false, emoji: "🍫" },
};
const THEMES = {
  aurora:  { name: "Aurora",  g1: "#2B3568", g2: "#1A1F44", g3: "#0E1130", accent: "#5AB0FF", accent2: "#7B6CFF", glowA: "rgba(120,200,255,.30)", glowB: "rgba(255,160,90,.22)" },
  ember:   { name: "Ember",   g1: "#3A2740", g2: "#241830", g3: "#140C1C", accent: "#FF8A4C", accent2: "#FF5E7E", glowA: "rgba(255,150,90,.30)",  glowB: "rgba(255,90,130,.20)" },
  pine:    { name: "Pine",    g1: "#1F3A38", g2: "#142724", g3: "#0A1614", accent: "#4FD9A8", accent2: "#5AB0FF", glowA: "rgba(90,230,180,.28)",  glowB: "rgba(120,200,255,.18)" },
  plum:    { name: "Plum",    g1: "#332A52", g2: "#211B38", g3: "#120E22", accent: "#B98CFF", accent2: "#FF7BC0", glowA: "rgba(180,130,255,.30)", glowB: "rgba(255,120,190,.20)" },
};

/* ---- coach memory snapshot ---- */
function buildMemory(history) {
  const all = history.flatMap((h) => h.tasks || []);
  const done = all.filter((t) => t.done);
  const seen = {}, doneC = {};
  all.forEach((t) => { const k = t.title.toLowerCase(); seen[k] = (seen[k] || 0) + 1; });
  done.forEach((t) => { const k = t.title.toLowerCase(); doneC[k] = (doneC[k] || 0) + 1; });
  const dodged = Object.keys(seen).filter((k) => seen[k] >= 3 && !(doneC[k] > 0)).slice(0, 4);
  const byWd = {}, byWdC = {};
  history.forEach((h) => { const wd = fromKey(h.date).getDay(); byWd[wd] = (byWd[wd] || 0) + (h.ml || 0); byWdC[wd] = (byWdC[wd] || 0) + 1; });
  let bestWd = null, bestV = -1;
  Object.keys(byWd).forEach((wd) => { const avg = byWd[wd] / byWdC[wd]; if (avg > bestV) { bestV = avg; bestWd = +wd; } });
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) { if ((history[i].ml || 0) >= CUP_ML) streak++; else break; }
  return { dodged, bestWd, fullStreak: streak, daysTracked: history.length };
}

const SAMPLE_INBOX = ["Reply to Dana's email", "Book the dentist", "Tidy the desk"];

function AppInner() {
  const [drink, setDrink] = useState("beer");
  const [theme, setTheme] = useState("aurora");
  const [onboarded, setOnboarded] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [plan, setPlan] = useState([]);          // {id,title,pour,done,daily,start?}
  const [dailies, setDailies] = useState([]);
  const [day, setDay] = useState(() => dKey(new Date()));
  const [seededDay, setSeededDay] = useState("");
  const [greetedDay, setGreetedDay] = useState("");
  const [history, setHistory] = useState([]);
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pending, setPending] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("inbox");
  const [planView, setPlanView] = useState("list"); // list | timeline
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState(null);
  const [quickAdd, setQuickAdd] = useState("");
  const [focusTask, setFocusTask] = useState(null);
  const [pourFx, setPourFx] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  const chatRef = useRef(null);

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      try {
        const store = (typeof window !== "undefined" && window.storage) ? window.storage : null;
        const r = store ? await store.get(STORE_KEY) : null;
        if (r && r.value) {
          const d = JSON.parse(r.value);
          if (d.drink) setDrink(d.drink);
          if (d.theme) setTheme(d.theme);
          if (d.onboarded) setOnboarded(true);
          if (d.dailies) setDailies(d.dailies);
          if (d.history) setHistory(d.history);
          if (d.inbox) setInbox(d.inbox);
          if (typeof d.soundOn === "boolean") setSoundOn(d.soundOn);
          if (d.planView) setPlanView(d.planView);
          const todayK = dKey(new Date());
          if (d.day === todayK) {
            if (d.plan) setPlan(d.plan);
            if (d.chat) setChat(d.chat);
            setSeededDay(d.seededDay || "");
            setGreetedDay(d.greetedDay || "");
            setDay(d.day);
          } else {
            if (d.day && d.plan) {
              const ml = fillMl(d.plan);
              const snap = d.plan.map((t) => ({ title: t.title, pour: t.pour, done: t.done, daily: !!t.daily }));
              setHistory((h) => [...(d.history || []), { date: d.day, ml, tasks: snap }]);
              const undone = d.plan.filter((t) => !t.done && !t.daily).map((t) => ({ id: uid(), title: t.title }));
              setInbox((ib) => [...(d.inbox || []), ...undone]);
            }
            setPlan([]); setChat([]); setDay(todayK); setSeededDay(""); setGreetedDay("");
          }
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  /* ---------- save ---------- */
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        const store = (typeof window !== "undefined" && window.storage) ? window.storage : null;
        if (!store) return;
        await store.set(STORE_KEY, JSON.stringify({
          drink, theme, onboarded, inbox, plan, dailies, day, seededDay,
          greetedDay, history, chat, soundOn, planView, v: 4,
        }));
      } catch (e) { flash("Couldn't save — storage may be full."); }
    })();
  }, [drink, theme, onboarded, inbox, plan, dailies, day, seededDay, greetedDay, history, chat, soundOn, planView, loaded]);

  /* ---------- dailies -> inbox ---------- */
  useEffect(() => {
    if (!loaded || !onboarded || seededDay === day) return;
    const wd = fromKey(day).getDay();
    const due = dailies.filter((dl) => dl.days.includes(wd));
    if (due.length) {
      setInbox((ib) => {
        const have = new Set(ib.filter((t) => t.dailyId).map((t) => t.dailyId));
        const fresh = due.filter((dl) => !have.has(dl.id)).map((dl) => ({ id: uid(), title: dl.title, dailyId: dl.id, pour: dl.pour }));
        return fresh.length ? [...fresh, ...ib] : ib;
      });
    }
    setSeededDay(day);
  }, [loaded, onboarded, day, dailies, seededDay]);

  /* ---------- morning greeting ---------- */
  useEffect(() => {
    if (!loaded || !onboarded || greetedDay === day || chat.length > 0) return;
    setGreetedDay(day);
    const mem = buildMemory(history);
    const hour = new Date().getHours();
    const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
    let text = `${part} — a fresh, empty cup. `;
    if (mem.daysTracked === 0) text += "Dump whatever's on your mind into the Inbox and we'll sort it together.";
    else if (mem.fullStreak >= 2) text += `That's ${mem.fullStreak} full cups running — lovely rhythm. What's first today?`;
    else if (mem.dodged.length) text += `One thing I've kept noticing: “${mem.dodged[0]}” keeps rolling over. Want to make that a small first pour?`;
    else if (mem.bestWd === fromKey(day).getDay()) text += `${WDL[mem.bestWd]}s tend to be your strong days — good one to aim high. What's on your plate?`;
    else text += "What's on your plate today?";
    setChat([{ role: "assistant", text }]);
  }, [loaded, onboarded, day, greetedDay]); // eslint-disable-line

  /* ---------- midnight rollover ---------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const todayK = dKey(new Date());
      if (todayK !== day) {
        const ml = fillMl(plan);
        const snap = plan.map((t) => ({ title: t.title, pour: t.pour, done: t.done, daily: !!t.daily }));
        setHistory((h) => [...h, { date: day, ml, tasks: snap }]);
        const undone = plan.filter((t) => !t.done && !t.daily).map((t) => ({ id: uid(), title: t.title }));
        setInbox((ib) => [...ib, ...undone]);
        setPlan([]); setChat([]); setDay(todayK); setSeededDay(""); setGreetedDay(""); setPending(null);
        flash("New day — fresh cup.");
      }
    }, 30000);
    return () => clearInterval(iv);
  }, [day, plan]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chat, thinking, pending]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3400); };

  /* ---------- pour sound + haptic ---------- */
  const pourSound = useCallback(() => {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      const dur = 0.55;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.8) * 0.5;
      }
      const src = ac.createBufferSource(); src.buffer = buf;
      const flt = ac.createBiquadFilter(); flt.type = "lowpass";
      flt.frequency.setValueAtTime(1000, ac.currentTime);
      flt.frequency.exponentialRampToValueAtTime(200, ac.currentTime + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.38, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      src.connect(flt); flt.connect(g); g.connect(ac.destination);
      src.start(); src.stop(ac.currentTime + dur);
      setTimeout(() => ac.close(), 800);
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(20);
  }, [soundOn]);

  /* ---------- derived ---------- */
  const dr = DRINK[drink];
  const th = THEMES[theme];
  const totalPct = plan.filter((t) => t.done).reduce((s, t) => s + t.pour, 0) + dailyBonusPct(plan);
  const cups = splitCups(totalPct);
  const plannedDailies = plan.filter((t) => t.daily);
  const dailiesDone = plannedDailies.length > 0 && plannedDailies.every((t) => t.done);
  const pourable = plan.filter((t) => !t.done).reduce((s, t) => s + t.pour, 0);
  const mem = buildMemory(history);
  const monthDays = history.filter((h) => monthKey(h.date) === monthKey(day));
  const monthGal = (monthDays.reduce((s, h) => s + h.ml, 0) + fillMl(plan)) / 3785.4;

  /* ---------- ops ---------- */
  function addInbox(title) { const t = (title || "").trim(); if (t) setInbox((p) => [{ id: uid(), title: t }, ...p]); }
  const deleteInbox = (id) => setInbox((p) => p.filter((t) => t.id !== id));
  function moveToPlan(item, pour) {
    setPlan((p) => [...p, { id: uid(), title: item.title, pour: clamp(pour, 1, 100), done: false, daily: !!item.dailyId }]);
    setInbox((p) => p.filter((t) => t.id !== item.id));
  }
  const deletePlan = (id) => { setPlan((p) => p.filter((t) => t.id !== id)); if (focusTask && focusTask.id === id) setFocusTask(null); };
  function togglePlan(id) {
    setPlan((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const t = next.find((x) => x.id === id);
      if (t && t.done) { setPourFx((s) => s + 1); pourSound(); }
      return next;
    });
    if (focusTask && focusTask.id === id) setFocusTask(null);
  }
  function movePlan(id, dir) {
    setPlan((prev) => {
      const i = prev.findIndex((t) => t.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }
  const setTaskStart = (id, start) => setPlan((p) => p.map((t) => (t.id === id ? { ...t, start } : t)));

  function acceptPending() {
    if (!pending) return;
    const item = pending.fromInboxId ? inbox.find((t) => t.id === pending.fromInboxId) : { id: uid(), title: pending.title };
    if (item) moveToPlan(item, pending.pour);
    setChat((c) => [...c, { role: "assistant", text: `Onto the Plan: “${pending.title}” at a ${pending.pour}% pour.` }]);
    setPending(null);
  }
  function rejectPending() {
    setChat((c) => [...c, { role: "assistant", text: "All good — tell me what feels right and we'll set it there." }]);
    setPending(null);
  }
  const saveDaily = (d) => setDailies((p) => { const i = p.findIndex((x) => x.id === d.id); if (i >= 0) { const n = [...p]; n[i] = d; return n; } return [...p, d]; });
  const deleteDaily = (id) => setDailies((p) => p.filter((d) => d.id !== id));

  /* ---------- AI coach ---------- */
  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    const next = [...chat, { role: "user", text: msg }];
    setChat(next); setInput(""); setThinking(true);

    const inboxList = inbox.length ? inbox.map((t) => t.title).join("; ") : "empty";
    const planList = plan.length ? plan.map((t) => `${t.title} (${t.pour}%${t.done ? ", done" : ""})`).join("; ") : "nothing planned yet";
    const memLines = [];
    if (mem.daysTracked) memLines.push(`Used the app ${mem.daysTracked} day(s).`);
    if (mem.fullStreak >= 2) memLines.push(`Streak: ${mem.fullStreak} full cups in a row.`);
    if (mem.dodged.length) memLines.push(`Keeps rolling over without finishing: ${mem.dodged.join(", ")}.`);
    if (mem.bestWd != null) memLines.push(`Strongest weekday: ${WDL[mem.bestWd]}.`);
    const recent = history.slice(-5).map((h) => `${h.date}: ${Math.round((h.ml / CUP_ML) * 100)}%`).join("; ");

    const sys =
      `You are the coach inside "Fill Up My Cup", a gentle ADHD-friendly daily task app. ` +
      `Warm, sharp, a little witty, never preachy, NEVER guilt them about undone work.\n\n` +
      `HOW IT WORKS: user brain-dumps tasks into an Inbox; you TRIAGE (what matters today, what waits, what to drop) ` +
      `and PROPOSE a "pour" value per task — the % of a cup of ${dr.name} it's worth (typical 10-25%, big dreaded 30-45%, tiny 5-10%). ` +
      `Accepted tasks join the Plan; finishing them fills the cup.\n\n` +
      `YOU HAVE MEMORY — use it naturally. ${memLines.join(" ")} Recent days: ${recent || "none yet"}.\n` +
      `Today's Inbox: ${inboxList}. Today's Plan: ${planList}. Cup: ${Math.round(totalPct)}% full.\n\n` +
      `Replies 1-3 sentences. Respond with ONLY a valid JSON object — no markdown, no backticks — exactly:\n` +
      `{"reply":"<message>","proposeTask":{"title":"<task>","pour":<int 1-100>},"addToInbox":["<task>"]}\n` +
      `proposeTask: set ONLY when proposing a specific pour for a specific task this turn; else null. ` +
      `addToInbox: titles to capture if asked; else [].`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sys,
          messages: next.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const data = await res.json();
      const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      let parsed = null;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
      catch { const s = raw.indexOf("{"), e = raw.lastIndexOf("}"); if (s !== -1 && e !== -1) { try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch {} } }
      setChat((c) => [...c, { role: "assistant", text: parsed?.reply || raw || "Say that again?" }]);
      if (Array.isArray(parsed?.addToInbox) && parsed.addToInbox.length) {
        parsed.addToInbox.forEach((t) => t && addInbox(t));
        flash(`Coach added ${parsed.addToInbox.length} to your Inbox.`);
      }
      if (parsed?.proposeTask && parsed.proposeTask.title) {
        const match = inbox.find((t) => t.title.toLowerCase() === parsed.proposeTask.title.toLowerCase());
        setPending({ title: parsed.proposeTask.title, pour: clamp(parsed.proposeTask.pour || 15, 1, 100), fromInboxId: match ? match.id : null });
      }
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", text: "Connection hiccup — couldn't reach me. Try again in a sec." }]);
    } finally { setThinking(false); }
  }
  function reflect() {
    setSheet(null); setTab("coach");
    send(`It's the end of my day — the cup is at ${Math.round(totalPct)}%. Give me a short, warm reflection on today and one encouraging thought for tomorrow. No guilt.`);
  }

  /* ---------- gates ---------- */
  if (loaded && !onboarded) {
    return <Onboarding th={THEMES[theme]} onDone={(seed) => { if (seed) setInbox(SAMPLE_INBOX.map((t) => ({ id: uid(), title: t }))); setOnboarded(true); }} />;
  }
  if (!loaded) {
    return <div className="app" style={themeVars(THEMES.aurora)}><style>{CSS}</style>
      <div className="boot"><div className="boot-c">◍</div><span>Filling up…</span></div></div>;
  }

  const today = new Date();
  const dayLabel = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="app" style={themeVars(th)}>
      <style>{CSS}</style>
      <div className="bg-glow a" /><div className="bg-glow b" />

      {/* ===== top bar ===== */}
      <header className="topbar">
        <div className="tb-l">
          <div className="kicker">FILL UP MY CUP</div>
          <h1>Today's Pour</h1>
          <div className="tb-date">{dayLabel}</div>
        </div>
        <div className="tb-r">
          <button className="gbtn" onClick={() => setSheet("insight")} title="Insights">✦</button>
          <button className="gbtn" onClick={() => setSheet("dailies")} title="Dailies">🔁</button>
          <button className="gbtn" onClick={() => setSheet("settings")} title="Settings">⚙</button>
        </div>
      </header>

      {/* ===== cup hero ===== */}
      <section className="hero">
        <div className="cups" key={pourFx}>
          {cups.map((c, i) => <Cup key={i} fill={c} drink={dr} idx={i} small={cups.length > 1} />)}
        </div>
        <div className="hero-pct">{Math.round(totalPct)}<span>%</span></div>
        <div className="hero-sub">
          {cups.length > 1 ? `${cups.length} cups going · ${Math.round(fillMl(plan))} ml today`
            : totalPct >= 100 ? "full — and overflowing"
            : totalPct === 0 ? "empty — let's pour"
            : `${Math.round(fillMl(plan))} ml in the glass`}
        </div>
        {dailiesDone && <div className="badge">✦ Dailies cleared — bonus poured</div>}
        {pourable > 0 && totalPct < 100 && <div className="ghost">{pourable}% more waiting on your Plan</div>}
        {plan.some((t) => t.done) && <button className="reflect" onClick={reflect}>Reflect on today →</button>}
      </section>

      {/* ===== tabs ===== */}
      <nav className="tabs">
        {[["inbox", "Inbox", inbox.length], ["plan", "Plan", plan.length], ["coach", "Coach", null]].map(([k, lbl, n]) => (
          <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            {lbl}{n != null && n > 0 ? <span className="tabn">{n}</span> : null}
          </button>
        ))}
      </nav>

      <div className="cols">
        {/* ===== INBOX ===== */}
        <section className={`panel ${tab === "inbox" ? "show" : ""}`}>
          <div className="p-hd"><h2>Inbox</h2><span className="p-sub">brain dump</span></div>
          <div className="qadd">
            <input className="qa-in" placeholder="Dump a task — type & enter" value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { addInbox(quickAdd); setQuickAdd(""); } }} />
            <button className="qa-go" onClick={() => { addInbox(quickAdd); setQuickAdd(""); }}>＋</button>
          </div>
          <div className="list">
            {inbox.length === 0 && <div className="empty">Clear. Dump anything on your mind — sort it later.</div>}
            {inbox.map((t) => (
              <div key={t.id} className="row">
                {t.dailyId && <span className="dtag">🔁</span>}
                <span className="r-title">{t.title}</span>
                <button className="r-triage" onClick={() => { setTab("coach"); send(`Help me triage this task: "${t.title}". What's it worth?`); }}>Triage</button>
                <button className="r-x" onClick={() => deleteInbox(t.id)}>×</button>
              </div>
            ))}
          </div>
        </section>

        {/* ===== PLAN ===== */}
        <section className={`panel ${tab === "plan" ? "show" : ""}`}>
          <div className="p-hd">
            <h2>Today's Plan</h2>
            <div className="view-toggle">
              <button className={planView === "list" ? "on" : ""} onClick={() => setPlanView("list")}>List</button>
              <button className={planView === "timeline" ? "on" : ""} onClick={() => setPlanView("timeline")}>Timeline</button>
            </div>
          </div>

          {planView === "list" ? (
            <div className="list">
              {plan.length === 0 && <div className="empty">Empty. Triage Inbox tasks with the Coach — they land here.</div>}
              {plan.map((t, i) => (
                <div key={t.id} className={`row plan-row ${t.done ? "done" : ""}`}>
                  <button className="check" onClick={() => togglePlan(t.id)}>{t.done ? "✓" : ""}</button>
                  <div className="r-main">
                    <span className="r-title">{t.daily && <span className="dtag">🔁</span>}{t.title}</span>
                    {t.start != null && <span className="r-time">{fmtMin(t.start)}</span>}
                  </div>
                  <span className="chip">{t.pour}%</span>
                  {!t.done && <button className="r-focus" onClick={() => setFocusTask(t)} title="Focus with me">◴</button>}
                  <div className="reord">
                    <button onClick={() => movePlan(t.id, -1)} disabled={i === 0}>▲</button>
                    <button onClick={() => movePlan(t.id, 1)} disabled={i === plan.length - 1}>▼</button>
                  </div>
                  <button className="r-x" onClick={() => deletePlan(t.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <Timeline plan={plan} onSetStart={setTaskStart} onToggle={togglePlan} onFocus={setFocusTask} drink={dr} />
          )}

          {plannedDailies.length > 0 && (
            <div className="dmeter">
              <span>Dailies {plannedDailies.filter((t) => t.done).length}/{plannedDailies.length}</span>
              <div className="dm-track"><div className="dm-fill" style={{ width: `${(plannedDailies.filter((t) => t.done).length / plannedDailies.length) * 100}%` }} /></div>
              <span className="dm-b">{dailiesDone ? "bonus ✓" : "+10% at full set"}</span>
            </div>
          )}
        </section>

        {/* ===== COACH ===== */}
        <section className={`panel ${tab === "coach" ? "show" : ""}`}>
          <div className="p-hd">
            <h2>Coach</h2>
            <span className="p-sub">{mem.daysTracked > 0 ? `knows ${mem.daysTracked}d of you` : "● online"}</span>
          </div>
          <div className="chat" ref={chatRef}>
            {chat.map((m, i) => <div key={i} className={`msg ${m.role}`}><div className="bubble">{m.text}</div></div>)}
            {thinking && <div className="msg assistant"><div className="bubble typing"><i /><i /><i /></div></div>}
            {pending && (
              <div className="propose">
                <div className="pr-txt">Add <b>“{pending.title}”</b> to your Plan as a <b>{pending.pour}% pour</b>?</div>
                <div className="pr-btns">
                  <button className="pr-yes" onClick={acceptPending}>Add to Plan</button>
                  <button className="pr-no" onClick={rejectPending}>Not quite</button>
                </div>
              </div>
            )}
          </div>
          <div className="quicks">
            {[["Sort my Inbox", "Look at my Inbox and help me triage it — what matters today?"],
              ["What's next?", "Of my planned tasks, what should I do right now and why?"],
              ["I'm stuck", "I'm struggling to start. Help me pick one thing and begin."]].map(([lbl, q]) => (
              <button key={lbl} className="quick" disabled={thinking} onClick={() => { setTab("coach"); send(q); }}>{lbl}</button>
            ))}
          </div>
          <div className="composer">
            <input className="comp-in" placeholder="Talk to your coach…" value={input}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
            <button className="comp-send" onClick={() => send()} disabled={thinking || !input.trim()}>↑</button>
          </div>
        </section>
      </div>

      {focusTask && <FocusSession task={focusTask} onComplete={() => togglePlan(focusTask.id)} onClose={() => setFocusTask(null)} />}

      {sheet === "insight" && (
        <Sheet title="Insights" onClose={() => setSheet(null)}>
          <Insights history={history} plan={plan} drink={dr} mem={mem} day={day} monthGal={monthGal}
            onWeekly={() => { setSheet(null); setTab("coach");
              send("Give me my weekly review: read my recent days, tell me what I got done, what I keep avoiding, one pattern you see, one thing to try next week. Warm, specific, no guilt."); }} />
        </Sheet>
      )}
      {sheet === "dailies" && <DailiesSheet dailies={dailies} onSave={saveDaily} onDelete={deleteDaily} onClose={() => setSheet(null)} />}
      {sheet === "settings" && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <Settings drink={drink} setDrink={setDrink} theme={theme} setTheme={setTheme} soundOn={soundOn} setSoundOn={setSoundOn} />
        </Sheet>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================================================
   helpers
   ============================================================ */
function themeVars(t) {
  return {
    "--g1": t.g1, "--g2": t.g2, "--g3": t.g3,
    "--accent": t.accent, "--accent2": t.accent2,
    "--glowA": t.glowA, "--glowB": t.glowB,
  };
}
function dailyBonusPct(plan) { const d = plan.filter((t) => t.daily); return d.length > 0 && d.every((t) => t.done) ? 10 : 0; }
function fillMl(plan) {
  const pct = plan.filter((t) => t.done).reduce((s, t) => s + t.pour, 0) + dailyBonusPct(plan);
  return (pct / 100) * CUP_ML;
}
function splitCups(total) {
  if (total <= 0) return [0];
  const cups = []; let rem = total;
  while (rem > 100 + FOAM_MAX) { cups.push(100 + FOAM_MAX); rem -= (100 + FOAM_MAX); }
  cups.push(rem); return cups;
}

/* ============================================================
   CUP — the jewel. Glass with refraction, glow, depth.
   ============================================================ */
function Cup({ fill, drink, idx, small }) {
  const target = clamp(fill, 0, 100);
  const over = Math.max(0, fill - 100);
  const [shown, setShown] = useState(target);

  useEffect(() => {
    let raf, start = null; const from = shown, to = target, dur = 900;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function step(ts) {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / dur);
      setShown(from + (to - from) * ease(p));
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line

  const TY = 44, BY = 392, IH = BY - TY;
  const lh = (shown / 100) * IH;
  const ly = BY - lh;
  const foamH = fill > 0 ? clamp(13 + over * 1.5, 13, 64) : 0;
  const foamY = ly - foamH + 8;
  const wobble = shown > 1 && shown < 99;
  const u = (s) => `${s}${idx}`;

  return (
    <svg viewBox="0 0 240 460" className={`cup ${small ? "sm" : ""}`}>
      <defs>
        <linearGradient id={u("liq")} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor={drink.hi} />
          <stop offset="1" stopColor={drink.lo} />
        </linearGradient>
        <linearGradient id={u("glass")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,.55)" />
          <stop offset="0.45" stopColor="rgba(255,255,255,.04)" />
          <stop offset="0.7" stopColor="rgba(255,255,255,.02)" />
          <stop offset="1" stopColor="rgba(255,255,255,.30)" />
        </linearGradient>
        <radialGradient id={u("glow")} cx="50%" cy="60%">
          <stop offset="0" stopColor={drink.glow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={drink.glow} stopOpacity="0" />
        </radialGradient>
        <clipPath id={u("in")}>
          <path d="M50 44 L190 44 L176 392 Q120 408 64 392 Z" />
        </clipPath>
        <filter id={u("soft")}><feGaussianBlur stdDeviation="6" /></filter>
      </defs>

      {/* aura glow behind glass */}
      {fill > 4 && <ellipse cx="120" cy="250" rx="120" ry="150" fill={`url(#${u("glow")})`} filter={`url(#${u("soft")})`} />}
      {/* contact shadow */}
      <ellipse cx="120" cy="420" rx="74" ry="13" fill="rgba(0,0,0,.4)" filter={`url(#${u("soft")})`} />

      <g clipPath={`url(#${u("in")})`}>
        {/* liquid */}
        {shown > 0.4 && (
          <>
            <rect x="46" y={ly} width="148" height={lh + 70} fill={`url(#${u("liq")})`} />
            {/* meniscus curve at the surface */}
            <ellipse cx="120" cy={ly + 1} rx="66" ry={wobble ? 9 : 6} fill={drink.hi}
              className={wobble ? "surface" : ""} opacity="0.95" />
            {/* inner depth shading */}
            <rect x="46" y={ly} width="22" height={lh + 70} fill="rgba(0,0,0,.16)" />
            <rect x="172" y={ly} width="22" height={lh + 70} fill="rgba(255,255,255,.12)" />
            {/* rising bubbles */}
            {drink.fizz && [...Array(7)].map((_, i) => (
              <circle key={i} className={`bub b${i}`} cx={70 + i * 16} r={2 + (i % 3)} fill="#fff" opacity="0.5" />
            ))}
          </>
        )}
        {/* foam head */}
        {fill > 0 && (
          <g>
            <rect x="46" y={foamY} width="148" height={foamH} fill={drink.foam} />
            <ellipse cx="120" cy={foamY} rx="68" ry="12" fill={drink.foam} />
            <ellipse cx="90" cy={foamY - 5} rx="23" ry="16" fill={drink.foam} />
            <ellipse cx="132" cy={foamY - 8} rx="27" ry="18" fill={drink.foam} />
            <ellipse cx="158" cy={foamY - 3} rx="18" ry="13" fill={drink.foam} />
            <ellipse cx="120" cy={foamY - 2} rx="40" ry="9" fill="#fff" opacity="0.35" />
          </g>
        )}
      </g>

      {/* glass body — refraction fill + crisp edge */}
      <path d="M50 44 L190 44 L176 392 Q120 408 64 392 Z" fill={`url(#${u("glass")})`} />
      <path d="M50 44 L190 44 L176 392 Q120 408 64 392 Z" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" />
      <path d="M50 44 L190 44 L176 392 Q120 408 64 392 Z" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="6" />
      {/* rim */}
      <ellipse cx="120" cy="44" rx="70" ry="10" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.5" />
      <ellipse cx="120" cy="44" rx="70" ry="10" fill="rgba(255,255,255,.06)" />
      {/* highlight streaks */}
      <path d="M66 62 Q60 230 76 372" fill="none" stroke="#fff" strokeWidth="7" opacity="0.7" strokeLinecap="round" />
      <path d="M168 70 Q174 220 158 360" fill="none" stroke="#fff" strokeWidth="3" opacity="0.32" strokeLinecap="round" />
    </svg>
  );
}

/* ============================================================
   Timeline — draggable hour grid
   ============================================================ */
function Timeline({ plan, onSetStart, onToggle, onFocus, drink }) {
  const wrapRef = useRef(null);
  const [drag, setDrag] = useState(null); // {id, offsetY}
  const hours = [];
  for (let h = DAY_START; h <= DAY_END; h++) hours.push(h);

  const scheduled = plan.filter((t) => t.start != null);
  const unscheduled = plan.filter((t) => t.start == null);

  function yToMin(y) {
    const raw = DAY_START * 60 + (y / HOUR_PX) * 60;
    return clamp(Math.round(raw / 15) * 15, DAY_START * 60, DAY_END * 60 - 30);
  }
  function onPointerDown(e, t) {
    const rect = wrapRef.current.getBoundingClientRect();
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top + wrapRef.current.scrollTop;
    const taskY = ((t.start - DAY_START * 60) / 60) * HOUR_PX;
    setDrag({ id: t.id, offsetY: cy - taskY });
  }
  function onPointerMove(e) {
    if (!drag) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top + wrapRef.current.scrollTop;
    onSetStart(drag.id, yToMin(cy - drag.offsetY));
  }
  const onPointerUp = () => setDrag(null);

  function schedule(t) { onSetStart(t.id, 9 * 60); }

  return (
    <div className="tl">
      {unscheduled.length > 0 && (
        <div className="tl-tray">
          <div className="tray-h">Tap to place on the timeline</div>
          <div className="tray-row">
            {unscheduled.map((t) => (
              <button key={t.id} className="tray-chip" onClick={() => schedule(t)}>
                {t.title} <span>{t.pour}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tl-grid" ref={wrapRef}
        onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
        onTouchMove={onPointerMove} onTouchEnd={onPointerUp}>
        <div className="tl-inner" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
          {hours.map((h) => (
            <div key={h} className="tl-hour" style={{ top: (h - DAY_START) * HOUR_PX }}>
              <span className="tl-hlbl">{fmtHour(h)}</span><span className="tl-hline" />
            </div>
          ))}
          {scheduled.map((t) => {
            const top = ((t.start - DAY_START * 60) / 60) * HOUR_PX;
            const h = Math.max(34, (clamp(t.pour, 5, 60) / 60) * HOUR_PX * 1.6);
            return (
              <div key={t.id} className={`tl-block ${t.done ? "done" : ""} ${drag && drag.id === t.id ? "dragging" : ""}`}
                style={{ top, height: h }}
                onMouseDown={(e) => onPointerDown(e, t)} onTouchStart={(e) => onPointerDown(e, t)}>
                <button className="tlb-check" onClick={(e) => { e.stopPropagation(); onToggle(t.id); }}>{t.done ? "✓" : ""}</button>
                <div className="tlb-main">
                  <span className="tlb-title">{t.title}</span>
                  <span className="tlb-meta">{fmtMin(t.start)} · {t.pour}%</span>
                </div>
                {!t.done && <button className="tlb-focus" onClick={(e) => { e.stopPropagation(); onFocus(t); }}>◴</button>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="tl-hint">Drag a block up or down to move it</div>
    </div>
  );
}

/* ============================================================
   Sheet
   ============================================================ */
function Sheet({ title, children, onClose }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-hd"><h3>{title}</h3><button className="sheet-x" onClick={onClose}>Done</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   Onboarding
   ============================================================ */
function Onboarding({ th, onDone }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: "◍", title: "Start each day empty", body: "Every morning you get a fresh, empty cup. Your one job: fill it back up by getting things done." },
    { icon: "✶", title: "Dump, then sort", body: "Throw everything on your mind into the Inbox. Your coach helps you sort what matters and what each task is worth." },
    { icon: "▲", title: "Finish a task, fill the cup", body: "Each task pours a little in. Clear your day and it overflows into foam — a big day even fills a second cup." },
  ];
  const s = steps[step];
  return (
    <div className="app" style={themeVars(th)}>
      <style>{CSS}</style>
      <div className="bg-glow a" /><div className="bg-glow b" />
      <div className="onb">
        <div className="onb-card" key={step}>
          <div className="onb-icon">{s.icon}</div>
          <h2 className="onb-title">{s.title}</h2>
          <p className="onb-body">{s.body}</p>
        </div>
        <div className="onb-dots">{steps.map((_, i) => <span key={i} className={`odot ${i === step ? "on" : ""}`} />)}</div>
        <div className="onb-act">
          {step < steps.length - 1
            ? <button className="onb-next" onClick={() => setStep(step + 1)}>Continue</button>
            : <button className="onb-next" onClick={() => onDone(true)}>Pour my first cup</button>}
          {step < steps.length - 1 && <button className="onb-skip" onClick={() => onDone(false)}>Skip</button>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Body-double focus session
   ============================================================ */
function FocusSession({ task, onComplete, onClose }) {
  const PRE = [10, 15, 25];
  const [mins, setMins] = useState(15);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(15 * 60);
  const [done, setDone] = useState(false);
  useEffect(() => { if (!running) setLeft(mins * 60); }, [mins, running]);
  useEffect(() => {
    if (!running) return;
    if (left <= 0) { setDone(true); setRunning(false); return; }
    const iv = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(iv);
  }, [running, left]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const prog = running || done ? 1 - left / (mins * 60) : 0;
  const checkIn = running && left > 0 && left % 300 === 0 && left !== mins * 60;
  const R = 86, C = 2 * Math.PI * R;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="focus" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="f-tag">FOCUS SESSION</div>
        <div className="f-task">{task.title}</div>
        <div className="f-ring">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="11" />
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--accent)" strokeWidth="11" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - prog)} transform="rotate(-90 100 100)"
              style={{ transition: "stroke-dashoffset 1s linear", filter: "drop-shadow(0 0 6px var(--accent))" }} />
          </svg>
          <div className="f-time">{done ? "Done" : `${mm}:${ss}`}</div>
        </div>
        {!running && !done && (
          <div className="f-pre">{PRE.map((m) => <button key={m} className={mins === m ? "on" : ""} onClick={() => setMins(m)}>{m}m</button>)}</div>
        )}
        <div className="f-msg">
          {done ? "Time's up. Did you get it moving? Mark it done if so — every bit counts."
            : checkIn ? "Still with you. Keep going — you're doing the thing."
            : running ? "I'm right here with you. Just this one task."
            : "Pick a length. I'll sit with you while you work — no multitasking, just this."}
        </div>
        <div className="f-act">
          {!running && !done && <button className="f-go" onClick={() => setRunning(true)}>Start — sit with me</button>}
          {running && <button className="f-go ghost" onClick={() => setRunning(false)}>Pause</button>}
          <button className="f-done" onClick={onComplete}>Mark task done ✓</button>
          <button className="f-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Dailies
   ============================================================ */
function DailiesSheet({ dailies, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState("");
  const [pour, setPour] = useState(10);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const toggle = (d) => setDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort());
  function add() {
    if (!title.trim() || !days.length) return;
    onSave({ id: uid(), title: title.trim(), pour: clamp(pour, 1, 50), days });
    setTitle(""); setPour(10); setDays([1, 2, 3, 4, 5]);
  }
  return (
    <Sheet title="Dailies" onClose={onClose}>
      <p className="s-note">Recurring tasks. Each morning the ones set for that weekday drop into your Inbox. Clear the whole set for a bonus pour.</p>
      <div className="dform">
        <input className="d-in" placeholder="Daily task name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="d-row">
          <div className="d-days">{WD.map((w, i) => <button key={i} className={days.includes(i) ? "on" : ""} onClick={() => toggle(i)}>{w[0]}</button>)}</div>
          <div className="d-pour"><span>{pour}%</span><input type="range" min="3" max="50" value={pour} onChange={(e) => setPour(+e.target.value)} /></div>
        </div>
        <button className="d-add" onClick={add}>Add daily</button>
      </div>
      <div className="dlist">
        {dailies.length === 0 && <div className="empty">No dailies yet.</div>}
        {dailies.map((d) => (
          <div key={d.id} className="ditem">
            <div className="di-m"><span className="di-t">{d.title}</span>
              <span className="di-d">{d.days.length === 7 ? "Every day" : d.days.map((x) => WD[x]).join(" ")}</span></div>
            <span className="chip">{d.pour}%</span>
            <button className="r-x" onClick={() => onDelete(d.id)}>×</button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ============================================================
   Insights
   ============================================================ */
const COMPARISONS = [
  [0.5, "a tall glass"], [1.5, "a kettle"], [3, "a big jug"], [6, "a bucket"],
  [12, "a water-cooler jug"], [25, "a kitchen sink"], [50, "a bathtub"],
  [120, "a hot tub"], [300, "a kiddie pool"], [1500, "a hot-tub party"],
  [5000, "a backyard pool"], [1e9, "an Olympic lane"],
];
const cmp = (g) => { for (const [n, l] of COMPARISONS) if (g <= n) return l; return "an ocean"; };

function Insights({ history, plan, drink, mem, day, monthGal, onWeekly }) {
  const withToday = [...history, { date: day, ml: fillMl(plan), tasks: plan }];
  const filled = withToday.filter((d) => d.ml > 0);
  const totalCups = withToday.reduce((s, d) => s + d.ml / CUP_ML, 0);
  const best = withToday.reduce((m, d) => Math.max(m, d.ml), 0);
  const avgPct = filled.length ? Math.round(filled.reduce((s, d) => s + (d.ml / CUP_ML) * 100, 0) / filled.length) : 0;
  const wd = [0, 0, 0, 0, 0, 0, 0], wdc = [0, 0, 0, 0, 0, 0, 0];
  withToday.forEach((d) => { const i = fromKey(d.date).getDay(); wd[i] += (d.ml / CUP_ML) * 100; wdc[i]++; });
  const wdAvg = wd.map((v, i) => wdc[i] ? Math.round(v / wdc[i]) : 0);
  const wdMax = Math.max(...wdAvg, 1);
  const last14 = withToday.slice(-14);
  return (
    <div className="ins">
      <button className="weekly" onClick={onWeekly}>
        <div><div className="wk-t">Get my weekly review</div>
          <div className="wk-s">The coach reads your recent days and writes you a personal recap</div></div>
        <span className="wk-a">→</span>
      </button>
      <div className="sgrid">
        <div className="sbox"><div className="sn">{monthGal.toFixed(1)}<span>gal</span></div><div className="sl">this month</div></div>
        <div className="sbox"><div className="sn">{mem.fullStreak}</div><div className="sl">full-cup streak</div></div>
        <div className="sbox"><div className="sn">{avgPct}<span>%</span></div><div className="sl">average day</div></div>
        <div className="sbox"><div className="sn">{Math.round((best / CUP_ML) * 100)}<span>%</span></div><div className="sl">best day ever</div></div>
      </div>
      <div className="cmpl">You've poured about <b>{cmp(monthGal)}</b> this month.</div>
      <div className="isec">
        <div className="ih">Pour by weekday</div>
        <div className="wdc">
          {WD.map((w, i) => (
            <div key={i} className="wdcol">
              <div className="wdbw"><div className="wdb" style={{ height: `${(wdAvg[i] / wdMax) * 100}%`, background: drink.hi }} /></div>
              <div className="wdl">{w[0]}</div>
            </div>
          ))}
        </div>
        {mem.bestWd != null && <div className="inote">{WDL[mem.bestWd]}s are your strongest — protect them.</div>}
      </div>
      <div className="isec">
        <div className="ih">Last {last14.length} days</div>
        <div className="hstrip">
          {last14.map((d, i) => {
            const pct = clamp((d.ml / CUP_ML) * 100, 0, 100);
            return <div key={i} className="hsc" title={`${d.date}: ${Math.round(pct)}%`}>
              <div className="hsf" style={{ height: `${pct}%`, background: drink.hi }} /></div>;
          })}
        </div>
      </div>
      {mem.dodged.length > 0 && (
        <div className="isec">
          <div className="ih">Keeps rolling over</div>
          <div className="dodge">{mem.dodged.map((d, i) => <span key={i} className="dchip">{d}</span>)}</div>
          <div className="inote">No judgment — these just need a smaller first step. Ask the coach.</div>
        </div>
      )}
      <div className="ifoot">Tracking {mem.daysTracked} day{mem.daysTracked !== 1 ? "s" : ""} · {totalCups.toFixed(1)} cups poured all-time</div>
    </div>
  );
}

/* ============================================================
   Settings
   ============================================================ */
function Settings({ drink, setDrink, theme, setTheme, soundOn, setSoundOn }) {
  return (
    <div className="settings">
      <div className="ssec">
        <div className="sh">Your drink</div>
        <div className="dgrid">
          {Object.entries(DRINK).map(([k, d]) => (
            <button key={k} className={`dcard ${k === drink ? "on" : ""}`} onClick={() => setDrink(k)}>
              <span className="dce">{d.emoji}</span><span className="dcn">{d.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ssec">
        <div className="sh">Mood</div>
        <div className="trow">
          {Object.entries(THEMES).map(([k, t]) => (
            <button key={k} className={`tdot ${k === theme ? "on" : ""}`} onClick={() => setTheme(k)}
              style={{ background: `linear-gradient(135deg,${t.accent},${t.accent2})` }} title={t.name} />
          ))}
        </div>
      </div>
      <div className="ssec">
        <div className="stoggle">
          <div><div className="sh">Pour sound</div><div className="ssub">A soft sound + haptic when a task fills the cup</div></div>
          <button className={`switch ${soundOn ? "on" : ""}`} onClick={() => setSoundOn(!soundOn)}><span /></button>
        </div>
      </div>
      <p className="s-note">Everything stays on this device. The cup resets each midnight; your history and the coach's memory of you carry forward.</p>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

.app{
  --ink:#EEF0FF; --ink2:#C8CDF0; --mut:#8D93C8; --faint:#5A5F8E;
  --line:rgba(255,255,255,.10); --hair:rgba(255,255,255,.07);
  --card:rgba(255,255,255,.055); --card2:rgba(255,255,255,.085);
  --green:#4FD9A8;
  font-family:'Space Grotesk',-apple-system,sans-serif;
  color:var(--ink); min-height:100vh; position:relative; overflow-x:hidden;
  -webkit-font-smoothing:antialiased; padding-bottom:36px;
  background:linear-gradient(170deg,var(--g1) 0%,var(--g2) 52%,var(--g3) 100%);
  background-attachment:fixed;
}
.app *{box-sizing:border-box;}
.app h1{font-size:24px;font-weight:700;margin:0;letter-spacing:-.02em;
  background:linear-gradient(100deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent;}
.app h2{font-size:16px;font-weight:700;margin:0;letter-spacing:-.01em;}
.app h3{font-size:17px;font-weight:700;margin:0;}
.app button{font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}

.bg-glow{position:fixed;border-radius:50%;filter:blur(70px);pointer-events:none;z-index:0;}
.bg-glow.a{width:380px;height:380px;background:var(--glowA);left:-130px;top:-110px;}
.bg-glow.b{width:340px;height:340px;background:var(--glowB);right:-120px;top:38%;}
.app>*{position:relative;z-index:1;}

.boot{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--mut);font-size:14px;}
.boot-c{font-size:46px;color:var(--accent);animation:spin 2s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

/* top bar */
.topbar{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 20px 8px;}
.kicker{font-size:10px;font-weight:700;letter-spacing:.2em;color:var(--accent);}
.tb-date{font-size:12.5px;color:var(--mut);margin-top:2px;}
.tb-r{display:flex;gap:9px;}
.gbtn{width:40px;height:40px;border-radius:14px;border:1px solid var(--line);
  background:var(--card);backdrop-filter:blur(12px);color:var(--accent);font-size:15px;
  display:flex;align-items:center;justify-content:center;transition:transform .12s;}
.gbtn:active{transform:scale(.9);}

/* hero */
.hero{display:flex;flex-direction:column;align-items:center;padding:6px 18px 24px;}
.cups{display:flex;align-items:flex-end;justify-content:center;gap:6px;height:268px;}
.cup{width:200px;height:auto;animation:cupin .55s cubic-bezier(.2,.9,.3,1);}
.cup.sm{width:138px;}
@keyframes cupin{from{transform:scale(.82) translateY(20px);opacity:0;}}
.surface{animation:slosh 1.7s ease-in-out;}
@keyframes slosh{0%,100%{transform:translateY(0);}25%{transform:translateY(-2.5px);}60%{transform:translateY(1.5px);}}
.hero-pct{font-size:52px;font-weight:700;letter-spacing:-.04em;line-height:1;margin-top:6px;
  background:linear-gradient(180deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent;}
.hero-pct span{font-size:25px;}
.hero-sub{font-size:13.5px;color:var(--mut);margin-top:3px;}
.ghost{font-size:12px;color:var(--faint);margin-top:6px;}
.badge{margin-top:9px;font-size:12px;font-weight:600;color:var(--accent);
  background:rgba(255,255,255,.07);border:1px solid var(--line);padding:6px 13px;border-radius:20px;}
.reflect{margin-top:11px;background:none;border:none;color:var(--accent);font-size:13.5px;font-weight:600;}
.reflect:active{opacity:.6;}

/* tabs */
.tabs{display:none;}
@media(max-width:780px){
  .tabs{display:flex;gap:5px;padding:5px;margin:0 18px 14px;background:var(--card);
    border:1px solid var(--line);border-radius:15px;backdrop-filter:blur(12px);}
  .tab{flex:1;border:none;background:transparent;color:var(--mut);font-size:13.5px;font-weight:600;
    padding:9px;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:6px;}
  .tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;}
  .tabn{background:rgba(0,0,0,.2);font-size:10.5px;padding:1px 7px;border-radius:9px;}
  .tab.on .tabn{background:rgba(255,255,255,.32);}
}

/* panels */
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;max-width:1120px;margin:0 auto;padding:0 18px;}
@media(max-width:780px){.cols{grid-template-columns:1fr;} .panel{display:none;} .panel.show{display:flex;}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:22px;
  backdrop-filter:blur(16px);overflow:hidden;display:flex;flex-direction:column;
  box-shadow:0 10px 40px rgba(0,0,0,.3);}
.p-hd{display:flex;justify-content:space-between;align-items:center;padding:16px 16px 12px;}
.p-sub{font-size:12px;color:var(--mut);}

/* view toggle */
.view-toggle{display:flex;gap:3px;background:rgba(0,0,0,.22);border-radius:10px;padding:3px;}
.view-toggle button{border:none;background:transparent;color:var(--mut);font-size:12px;font-weight:600;
  padding:5px 11px;border-radius:8px;}
.view-toggle button.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;}

/* quick add */
.qadd{display:flex;gap:8px;padding:0 14px 12px;}
.qa-in{flex:1;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:13px;
  padding:11px 13px;font-size:15px;color:var(--ink);outline:none;}
.qa-in:focus{border-color:var(--accent);}
.qa-go{width:42px;border-radius:13px;border:none;font-size:20px;font-weight:700;color:#10122c;
  background:linear-gradient(135deg,var(--accent),var(--accent2));}
.qa-go:active{transform:scale(.94);}

/* rows / lists */
.list{padding:4px 8px 12px;display:flex;flex-direction:column;}
.empty{padding:26px 18px;text-align:center;color:var(--faint);font-size:13px;line-height:1.6;}
.row{display:flex;align-items:center;gap:9px;padding:11px 10px;border-radius:14px;transition:background .12s;}
.row+.row{box-shadow:inset 0 1px 0 var(--hair);}
.row:hover{background:var(--hair);}
.r-main{flex:1;min-width:0;display:flex;flex-direction:column;}
.r-title{font-size:14.5px;font-weight:500;line-height:1.35;}
.r-time{font-size:11px;color:var(--accent);margin-top:2px;font-weight:600;}
.r-x{flex-shrink:0;background:none;border:none;color:var(--faint);font-size:19px;line-height:1;padding:0 3px;}
.r-x:active{color:#FF6B6B;}
.dtag{font-size:10px;margin-right:5px;}
.r-triage{flex-shrink:0;background:rgba(255,255,255,.08);color:var(--accent);border:1px solid var(--line);
  font-size:12px;font-weight:600;padding:6px 12px;border-radius:11px;}
.r-triage:active{transform:scale(.95);}
.plan-row.done .r-title{color:var(--faint);text-decoration:line-through;}
.check{flex-shrink:0;width:26px;height:26px;border-radius:9px;border:2px solid var(--faint);
  background:transparent;color:#10122c;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;
  padding:0;transition:transform .14s;}
.check:active{transform:scale(.85);}
.plan-row.done .check{background:linear-gradient(135deg,var(--green),var(--accent));border-color:transparent;}
.chip{flex-shrink:0;font-size:12.5px;font-weight:700;color:var(--accent);
  background:rgba(255,255,255,.08);border:1px solid var(--line);padding:3px 9px;border-radius:9px;}
.plan-row.done .chip{color:var(--green);}
.r-focus{flex-shrink:0;background:none;border:none;color:var(--accent);font-size:17px;padding:0 2px;}
.r-focus:active{transform:scale(.85);}
.reord{display:flex;flex-direction:column;gap:1px;}
.reord button{background:none;border:none;color:var(--faint);font-size:9px;padding:1px 3px;line-height:1;}
.reord button:disabled{opacity:.3;}
.reord button:active:not(:disabled){color:var(--accent);}

.dmeter{display:flex;align-items:center;gap:9px;padding:12px 16px;box-shadow:inset 0 1px 0 var(--hair);
  font-size:11.5px;color:var(--mut);}
.dm-track{flex:1;height:6px;background:rgba(0,0,0,.25);border-radius:3px;overflow:hidden;}
.dm-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;transition:width .4s;}
.dm-b{color:var(--accent);font-weight:600;}

/* timeline */
.tl{display:flex;flex-direction:column;}
.tl-tray{padding:8px 14px 4px;}
.tray-h{font-size:11px;color:var(--mut);margin-bottom:7px;}
.tray-row{display:flex;flex-wrap:wrap;gap:6px;}
.tray-chip{background:rgba(255,255,255,.08);border:1px solid var(--line);color:var(--ink);
  font-size:12px;font-weight:500;padding:7px 10px;border-radius:11px;}
.tray-chip span{color:var(--accent);font-weight:700;margin-left:3px;}
.tray-chip:active{transform:scale(.96);}
.tl-grid{height:400px;overflow-y:auto;position:relative;padding:6px 0;}
.tl-grid::-webkit-scrollbar{width:0;}
.tl-inner{position:relative;}
.tl-hour{position:absolute;left:0;right:0;height:0;}
.tl-hlbl{position:absolute;left:10px;top:-7px;font-size:9.5px;color:var(--faint);font-weight:600;}
.tl-hline{position:absolute;left:58px;right:12px;top:0;border-top:1px solid var(--hair);}
.tl-block{position:absolute;left:58px;right:12px;border-radius:12px;padding:7px 9px;
  background:linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,.06));
  border:1px solid var(--line);display:flex;align-items:center;gap:8px;cursor:grab;
  box-shadow:0 4px 14px rgba(0,0,0,.3);overflow:hidden;touch-action:none;}
.tl-block.dragging{cursor:grabbing;border-color:var(--accent);
  box-shadow:0 8px 22px rgba(0,0,0,.45);z-index:5;}
.tl-block.done{opacity:.5;}
.tl-block.done .tlb-title{text-decoration:line-through;}
.tlb-check{flex-shrink:0;width:21px;height:21px;border-radius:7px;border:2px solid var(--faint);
  background:transparent;color:#10122c;font-size:11px;font-weight:800;padding:0;}
.tl-block.done .tlb-check{background:linear-gradient(135deg,var(--green),var(--accent));border-color:transparent;}
.tlb-main{flex:1;min-width:0;display:flex;flex-direction:column;}
.tlb-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tlb-meta{font-size:10px;color:var(--mut);margin-top:1px;}
.tlb-focus{flex-shrink:0;background:none;border:none;color:var(--accent);font-size:15px;}
.tl-hint{text-align:center;font-size:11px;color:var(--faint);padding:8px;}

/* coach */
.chat{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;min-height:250px;max-height:372px;}
.chat::-webkit-scrollbar{width:0;}
.msg{display:flex;max-width:88%;}
.msg.user{align-self:flex-end;}
.bubble{padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.45;animation:bin .25s ease-out;}
@keyframes bin{from{transform:translateY(6px);opacity:0;}}
.msg.assistant .bubble{background:rgba(255,255,255,.07);border:1px solid var(--line);border-bottom-left-radius:5px;}
.msg.user .bubble{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;
  font-weight:500;border-bottom-right-radius:5px;}
.typing{display:flex;gap:4px;}
.typing i{width:7px;height:7px;border-radius:50%;background:var(--mut);animation:bob 1s infinite;}
.typing i:nth-child(2){animation-delay:.15s;}.typing i:nth-child(3){animation-delay:.3s;}
@keyframes bob{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-5px);opacity:1;}}
.propose{align-self:stretch;background:rgba(255,255,255,.08);border:1px solid var(--line);border-radius:15px;padding:13px;}
.pr-txt{font-size:13.5px;line-height:1.5;margin-bottom:11px;}
.pr-btns{display:flex;gap:8px;}
.pr-yes{flex:1;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border:none;
  padding:10px;border-radius:11px;font-weight:700;font-size:13px;}
.pr-yes:active{transform:scale(.97);}
.pr-no{flex:1;background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--ink2);
  padding:10px;border-radius:11px;font-weight:500;font-size:13px;}
.quicks{display:flex;gap:7px;padding:0 13px 11px;flex-wrap:wrap;}
.quick{background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--ink2);
  font-size:12px;font-weight:500;padding:7px 12px;border-radius:15px;}
.quick:active:not(:disabled){border-color:var(--accent);color:var(--accent);}
.quick:disabled{opacity:.4;}
.composer{display:flex;gap:8px;padding:12px 13px;box-shadow:inset 0 1px 0 var(--hair);}
.comp-in{flex:1;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:20px;
  padding:10px 15px;font-size:14.5px;color:var(--ink);outline:none;}
.comp-in:focus{border-color:var(--accent);}
.comp-send{width:38px;height:38px;border-radius:50%;border:none;font-size:17px;font-weight:700;color:#10122c;
  background:linear-gradient(135deg,var(--accent),var(--accent2));flex-shrink:0;}
.comp-send:disabled{opacity:.4;}
.comp-send:active:not(:disabled){transform:scale(.92);}

.bub{animation:rise 3.6s ease-in infinite;}
.b0{animation-delay:0s;}.b1{animation-delay:.6s;}.b2{animation-delay:1.2s;}
.b3{animation-delay:.4s;}.b4{animation-delay:2s;}.b5{animation-delay:1s;}.b6{animation-delay:2.6s;}
@keyframes rise{0%{transform:translateY(0);opacity:0;}15%{opacity:.55;}100%{transform:translateY(-200px);opacity:0;}}

/* sheets */
.sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;
  align-items:flex-end;justify-content:center;animation:fade .2s;backdrop-filter:blur(3px);}
@media(min-width:780px){.sheet-bg{align-items:center;}}
@keyframes fade{from{opacity:0;}}
.sheet{width:100%;max-width:500px;border-radius:24px 24px 0 0;max-height:88vh;overflow-y:auto;
  background:linear-gradient(170deg,var(--g2),var(--g3));border:1px solid var(--line);
  border-bottom:none;animation:up .3s cubic-bezier(.2,.9,.3,1);}
@media(min-width:780px){.sheet{border-radius:24px;border-bottom:1px solid var(--line);}}
@keyframes up{from{transform:translateY(46px);opacity:.5;}}
.grip{width:36px;height:5px;background:var(--line);border-radius:3px;margin:9px auto 0;}
.sheet-hd{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;}
.sheet-x{background:none;border:none;color:var(--accent);font-size:15px;font-weight:600;}
.sheet-body{padding:0 18px 26px;}
.s-note{font-size:12.5px;color:var(--mut);line-height:1.55;margin:0 0 16px;}

/* onboarding */
.onb{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;gap:28px;}
.onb-card{text-align:center;max-width:330px;animation:oin .42s ease-out;}
@keyframes oin{from{transform:translateY(16px);opacity:0;}}
.onb-icon{font-size:60px;color:var(--accent);margin-bottom:10px;
  filter:drop-shadow(0 0 16px var(--accent));}
.onb-title{font-size:25px;font-weight:700;letter-spacing:-.02em;margin-bottom:10px;}
.onb-body{font-size:15px;color:var(--mut);line-height:1.6;}
.onb-dots{display:flex;gap:7px;}
.odot{width:7px;height:7px;border-radius:50%;background:var(--line);transition:.2s;}
.odot.on{background:var(--accent);width:22px;border-radius:4px;}
.onb-act{display:flex;flex-direction:column;gap:9px;width:100%;max-width:300px;}
.onb-next{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border:none;
  border-radius:15px;padding:15px;font-size:15.5px;font-weight:700;}
.onb-next:active{transform:scale(.98);}
.onb-skip{background:none;border:none;color:var(--mut);font-size:14px;font-weight:500;}

/* focus */
.focus{width:100%;max-width:420px;border-radius:24px 24px 0 0;padding:0 24px 26px;text-align:center;
  background:linear-gradient(170deg,var(--g2),var(--g3));border:1px solid var(--line);border-bottom:none;
  animation:up .3s cubic-bezier(.2,.9,.3,1);}
@media(min-width:780px){.focus{border-radius:24px;}}
.f-tag{font-size:11px;font-weight:700;letter-spacing:.16em;color:var(--accent);margin-top:14px;}
.f-task{font-size:19px;font-weight:700;margin-top:6px;}
.f-ring{position:relative;width:200px;height:200px;margin:18px auto 4px;}
.f-ring svg{width:100%;height:100%;}
.f-time{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:38px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;}
.f-pre{display:flex;gap:8px;justify-content:center;margin:4px 0;}
.f-pre button{background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink2);
  font-size:14px;font-weight:600;padding:8px 16px;border-radius:11px;}
.f-pre button.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border-color:transparent;}
.f-msg{font-size:13.5px;color:var(--mut);line-height:1.5;margin:12px auto 16px;max-width:300px;min-height:42px;}
.f-act{display:flex;flex-direction:column;gap:9px;}
.f-go{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border:none;
  border-radius:13px;padding:14px;font-size:15px;font-weight:700;}
.f-go.ghost{background:rgba(255,255,255,.08);color:var(--ink);}
.f-done{background:rgba(79,217,168,.16);border:1px solid rgba(79,217,168,.4);color:var(--green);
  border-radius:13px;padding:12px;font-size:14px;font-weight:700;}
.f-close{background:none;border:none;color:var(--mut);font-size:14px;font-weight:500;}

/* dailies */
.dform{background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:15px;padding:13px;margin-bottom:16px;}
.d-in{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:11px;
  padding:11px 13px;font-size:15px;color:var(--ink);outline:none;margin-bottom:11px;}
.d-in:focus{border-color:var(--accent);}
.d-row{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px;flex-wrap:wrap;}
.d-days{display:flex;gap:5px;}
.d-days button{width:31px;height:31px;border-radius:9px;border:1px solid var(--line);background:rgba(255,255,255,.05);
  color:var(--mut);font-size:12px;font-weight:600;}
.d-days button.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border-color:transparent;}
.d-pour{display:flex;align-items:center;gap:8px;}
.d-pour span{font-size:13px;font-weight:700;color:var(--accent);min-width:34px;}
.d-pour input{width:88px;accent-color:var(--accent);}
.d-add{width:100%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;
  border:none;border-radius:12px;padding:12px;font-weight:700;font-size:14px;}
.dlist{display:flex;flex-direction:column;}
.ditem{display:flex;align-items:center;gap:10px;padding:12px 4px;}
.ditem+.ditem{box-shadow:inset 0 1px 0 var(--hair);}
.di-m{flex:1;display:flex;flex-direction:column;}
.di-t{font-size:14.5px;font-weight:500;}
.di-d{font-size:11.5px;color:var(--mut);margin-top:2px;}

/* insights */
.weekly{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));color:#10122c;border:none;
  border-radius:16px;padding:15px 17px;text-align:left;margin-bottom:18px;}
.weekly:active{transform:scale(.99);}
.wk-t{font-size:15px;font-weight:700;}
.wk-s{font-size:12px;opacity:.85;margin-top:3px;line-height:1.4;}
.wk-a{font-size:20px;font-weight:700;}
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.sbox{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:14px;padding:14px;}
.sn{font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1;}
.sn span{font-size:14px;color:var(--mut);margin-left:3px;}
.sl{font-size:11.5px;color:var(--mut);margin-top:5px;}
.cmpl{font-size:13.5px;color:var(--ink2);line-height:1.5;margin-bottom:18px;}
.cmpl b{color:var(--accent);}
.isec{margin-bottom:20px;}
.ih{font-size:12.5px;font-weight:700;color:var(--ink2);margin-bottom:11px;}
.wdc{display:flex;gap:7px;height:94px;align-items:flex-end;}
.wdcol{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;}
.wdbw{flex:1;width:100%;display:flex;align-items:flex-end;}
.wdb{width:100%;border-radius:5px 5px 2px 2px;min-height:3px;transition:height .5s cubic-bezier(.3,1,.4,1);}
.wdl{font-size:10px;color:var(--mut);font-weight:600;}
.inote{font-size:11.5px;color:var(--mut);margin-top:9px;line-height:1.45;}
.hstrip{display:flex;gap:5px;height:52px;}
.hsc{flex:1;border:1px solid var(--line);border-radius:3px 3px 5px 5px;display:flex;align-items:flex-end;
  overflow:hidden;background:rgba(0,0,0,.2);}
.hsf{width:100%;transition:height .4s;}
.dodge{display:flex;flex-wrap:wrap;gap:7px;}
.dchip{background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--ink2);
  font-size:12px;font-weight:500;padding:6px 12px;border-radius:13px;}
.ifoot{font-size:11px;color:var(--faint);text-align:center;}

/* settings */
.ssec{margin-bottom:22px;}
.sh{font-size:14px;font-weight:700;}
.ssub{font-size:12px;color:var(--mut);margin-top:2px;line-height:1.4;}
.ssec .sh{margin-bottom:11px;}
.dgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.dcard{background:rgba(255,255,255,.05);border:2px solid transparent;border-radius:15px;padding:16px 8px;
  display:flex;flex-direction:column;align-items:center;gap:7px;}
.dcard.on{border-color:var(--accent);background:rgba(255,255,255,.09);}
.dce{font-size:27px;}
.dcn{font-size:12.5px;font-weight:600;}
.trow{display:flex;gap:12px;}
.tdot{width:40px;height:40px;border-radius:13px;border:3px solid transparent;}
.tdot.on{border-color:#fff;transform:scale(1.08);}
.stoggle{display:flex;justify-content:space-between;align-items:center;gap:14px;}
.stoggle .sh{margin-bottom:0;}
.switch{width:50px;height:30px;border-radius:16px;border:none;background:rgba(255,255,255,.16);
  position:relative;transition:.2s;flex-shrink:0;}
.switch.on{background:var(--green);}
.switch span{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;
  transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.4);}
.switch.on span{left:23px;}

/* toast */
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:rgba(255,255,255,.12);border:1px solid var(--line);backdrop-filter:blur(14px);
  color:var(--ink);padding:11px 18px;border-radius:22px;font-size:13px;font-weight:500;z-index:80;
  box-shadow:0 8px 28px rgba(0,0,0,.4);animation:tup .3s;max-width:90vw;}
@keyframes tup{from{transform:translate(-50%,14px);opacity:0;}}
`;
