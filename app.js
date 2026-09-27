(() => {
  "use strict";

  /* ---------- Sections (order = ribbon order = wheel order) ---------- */
  const SECTIONS = [
    { key: "home",        label: "Home",         icon: "#i-house"  },
    { key: "smash",       label: "Smash repair", icon: "#i-car"    },
    { key: "performance", label: "Performance",  icon: "#i-wrench" },
    { key: "servicing",   label: "Servicing",    icon: "#i-gear"   },
  ];
  const LABELS = Object.fromEntries(SECTIONS.map(s => [s.key, s.label]));
  // Other pages the assistant can open
  const PAGES = {
    "services-page":    { url: "/services",     label: "Services" },
    "performance-page": { url: "/performance",  label: "How we work" },
    "servicing-page":   { url: "/servicing",    label: "Servicing" },
    "about-page":       { url: "/about",        label: "About us" },
    "account-page":     { url: "/account",      label: "My account" },
    "book-service":     { url: "/account#book", label: "Book a service" },
  };
  const PHONE = document.body.dataset.phone || "";
  const STEP = 90; // degrees the wheel turns per section

  const NS = "http://www.w3.org/2000/svg";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; }; // 0° = right
  const f = n => n.toFixed(2);

  /* ---------- Build the wheel ---------- */
  const back = $("#wheel-back"), front = $("#wheel-front"), caliper = $("#caliper");

  // Dial ticks
  for (let i = 0; i < 72; i++) {
    const major = i % 18 === 0, a = i * 5;
    const [x1, y1] = pt(major ? 122 : 127, a), [x2, y2] = pt(133, a);
    el("line", { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), stroke: "#1c1f22", "stroke-width": major ? 2.5 : 1, "stroke-linecap": "round", opacity: major ? 1 : .45 }, back);
  }
  // Tyre
  el("circle", { r: 94, fill: "none", stroke: "#1c1f22", "stroke-width": 22 }, back);
  el("circle", { r: 102, fill: "none", stroke: "#0f1113", "stroke-width": 5, "stroke-dasharray": "2.4 3.6" }, back);
  el("circle", { r: 88.5, fill: "none", stroke: "#34393d", "stroke-width": 1 }, back);
  // Rim barrel + lip
  el("circle", { r: 82.5, fill: "#22272b" }, back);
  el("circle", { r: 81, fill: "none", stroke: "url(#lipG)", "stroke-width": 3 }, back);
  // Brake disc with drilled holes
  el("circle", { r: 64, fill: "#7c8489" }, back);
  el("circle", { r: 64, fill: "none", stroke: "#5f676c", "stroke-width": 2 }, back);
  [44, 54].forEach((r, ring) => {
    for (let i = 0; i < 18; i++) {
      const [x, y] = pt(r, i * 20 + ring * 10);
      el("circle", { cx: f(x), cy: f(y), r: 1.8, fill: "#3b4247" }, back);
    }
  });
  el("circle", { r: 31, fill: "#2d3337", stroke: "#4a5257", "stroke-width": 1.5 }, back);

  // Caliper (static, sits between disc and spokes)
  (() => {
    const r1 = 52, r2 = 70, a1 = -64, a2 = -20;
    const o1 = pt(r2, a1), o2 = pt(r2, a2), i2 = pt(r1, a2), i1 = pt(r1, a1);
    el("path", {
      d: `M${f(o1[0])} ${f(o1[1])} A${r2} ${r2} 0 0 1 ${f(o2[0])} ${f(o2[1])} L${f(i2[0])} ${f(i2[1])} A${r1} ${r1} 0 0 0 ${f(i1[0])} ${f(i1[1])}Z`,
      fill: "var(--signal)", stroke: "var(--signal)", "stroke-width": 7, "stroke-linejoin": "round",
    }, caliper);
  })();

  // Split five-spoke design
  for (let k = 0; k < 5; k++) {
    const c = k * 72 - 90;
    [-1, 1].forEach(s => {
      const ic = c + s * 7, oc = c + s * 12;
      const p = [pt(19, ic - 6), pt(80, oc - 2.6), pt(80, oc + 2.6), pt(19, ic + 6)];
      el("polygon", { points: p.map(q => q.map(f).join(",")).join(" "), fill: "url(#spokeG)", stroke: "#1c1f22", "stroke-width": .6, "stroke-linejoin": "round" }, front);
    });
  }
  // Hub, lug nuts, centre cap
  el("circle", { r: 22, fill: "#3a4248", stroke: "#a9b1b7", "stroke-width": 1.5 }, front);
  for (let k = 0; k < 5; k++) { const [x, y] = pt(13.5, k * 72 - 54); el("circle", { cx: f(x), cy: f(y), r: 2.7, fill: "#d3d8dc" }, front); }
  el("circle", { r: 7.5, fill: "var(--signal)", stroke: "#1c1f22", "stroke-width": 1 }, front);

  // Section markers on the dial; section i sits at -90°·i and turns to the pointer (0°)
  const uprights = [];
  const markers = SECTIONS.map((s, i) => {
    const [x, y] = pt(113, -STEP * i);
    const g = el("g", { class: "marker", transform: `translate(${f(x)} ${f(y)})`, tabindex: "0", role: "link", "aria-label": s.label }, front);
    const u = el("g", {}, g);
    el("circle", { r: 15 }, u);
    el("use", { href: s.icon, x: -9, y: -9, width: 18, height: 18 }, u);
    uprights.push(u);
    const go = () => goTo(s.key);
    g.addEventListener("click", go);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return g;
  });

  /* ---------- Scroll-driven rotation ---------- */
  const track = $("#track"), stage = $(".stage"), hint = $(".scroll-hint");
  const panels = $$(".panel");
  let activeKey = null;

  function setActive(key) {
    if (key === activeKey) return;
    activeKey = key;
    markers.forEach((m, i) => m.classList.toggle("active", SECTIONS[i].key === key));
  }

  function update() {
    const rect = track.getBoundingClientRect();
    const max = track.offsetHeight - stage.offsetHeight;
    const p = Math.min(1, Math.max(0, -rect.top / max));
    const s = p * (SECTIONS.length - 1);
    const deg = s * STEP;

    back.setAttribute("transform", `rotate(${f(deg)})`);
    front.setAttribute("transform", `rotate(${f(deg)})`);
    uprights.forEach(u => u.setAttribute("transform", `rotate(${f(-deg)})`));

    panels.forEach((pn, i) => {
      const d = s - i;
      const o = Math.max(0, 1 - Math.abs(d) * 2.4);
      pn.style.opacity = o;
      pn.style.transform = `translateY(${f(-d * 70)}px)`;
      pn.style.visibility = o > 0.01 ? "visible" : "hidden";
      pn.inert = Math.abs(d) >= 0.5;
    });
    if (hint) hint.style.opacity = s < 0.15 ? 1 : 0;

    setActive(SECTIONS[Math.round(s)].key);
  }

  let ticking = false;
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  update();

  function goTo(key) {
    const target = document.getElementById(key);
    if (!target) return;
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", "#" + key);
  }

  /* ---------- Assistant ---------- */
  const A = $("#assistant");
  const log = $(".log", A), form = $(".composer", A), input = form.q;
  const micBtn = $(".mic", A), voiceBtn = $(".voice", A);
  const history_ = [];
  let busy = false, voiceOn = false;

  const open = () => { A.classList.add("open"); document.body.classList.add("chat-docked"); setTimeout(() => input.focus({ preventScroll: true }), 50); };
  const close = () => { A.classList.remove("open"); document.body.classList.remove("chat-docked"); speechSynthesis?.cancel?.(); };
  $(".launcher", A).addEventListener("click", open);
  $(".minimise", A).addEventListener("click", close);

  function addMsg(role, text) {
    const m = document.createElement("div");
    m.className = "msg " + role;
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }
  function addTyping() {
    const m = addMsg("bot", "");
    m.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    return m;
  }

  addMsg("bot", "G'day! I can answer questions about repairs, performance work and servicing, or take you anywhere on the site. Try \u201cbook a service\u201d or \u201chow does dyno testing work?\u201d");

  // Open on the home page by default (not on small screens, where it would cover the content)
  if ((location.hash === "" || location.hash === "#home") && innerWidth > 860) open();

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    open();
    addMsg("user", text);
    history_.push({ role: "user", content: text });
    input.value = "";
    busy = true; A.dataset.state = "thinking";
    const typing = addTyping();

    let data;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history_.slice(-16), page: activeKey }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (err) {
      console.warn("Assistant offline, using local fallback:", err);
      data = localFallback(text);
    }

    typing.remove();
    busy = false; A.dataset.state = "";
    const reply = (data && data.reply) || "Sorry, I didn't catch that. Could you rephrase?";
    addMsg("bot", reply);
    history_.push({ role: "assistant", content: reply });
    speak(reply);
    if (data && data.action) runAction(data.action);
  }

  function runAction(a) {
    if (a.type === "navigate" && LABELS[a.section]) {
      addMsg("note", "Showing " + LABELS[a.section]);
      goTo(a.section);
    } else if (a.type === "navigate" && PAGES[a.section]) {
      addMsg("note", "Opening " + PAGES[a.section].label + "\u2026");
      setTimeout(() => { location.href = PAGES[a.section].url; }, 1200);
    } else if (a.type === "call" && PHONE) {
      addMsg("note", "Starting a call\u2026");
      setTimeout(() => { location.href = "tel:" + PHONE; }, 600);
    }
  }

  // Keyword routing when the AI endpoint isn't reachable
  function localFallback(text) {
    const t = text.toLowerCase();
    const routes = [
      ["book-service", /book|appointment/],
      ["account-page", /log ?in|account|reminder/],
      ["performance-page", /dyno|how do you|process|build/],
      ["smash", /smash|crash|accident|panel|dent|paint|insur|collision/],
      ["performance", /perform|tun|exhaust|turbo|upgrade|power/],
      ["servicing", /servic|oil|logbook|brake|tyre|filter/],
      ["services-page", /services|everything|list/],
      ["about-page", /about|call|phone|contact|hour|open|address|where/],
      ["home", /home|start|main/],
    ];
    const hit = routes.find(([, re]) => re.test(t));
    if (hit) {
      const label = LABELS[hit[0]] || PAGES[hit[0]].label;
      return { reply: `I can't reach the assistant service right now, but here's ${label}.`, action: { type: "navigate", section: hit[0] } };
    }
    return { reply: "I can't reach the assistant service right now. Give the workshop a call and the team will help." };
  }

  form.addEventListener("submit", e => { e.preventDefault(); send(input.value); });
  $$("[data-ask]").forEach(b => b.addEventListener("click", () => send(b.dataset.ask)));

  /* Voice output */
  const canSpeak = "speechSynthesis" in window;
  if (!canSpeak) voiceBtn.hidden = true;
  const setVoice = on => { voiceOn = on && canSpeak; voiceBtn.setAttribute("aria-pressed", String(voiceOn)); if (!voiceOn && canSpeak) speechSynthesis.cancel(); };
  voiceBtn.addEventListener("click", () => setVoice(!voiceOn));
  function speak(text) {
    if (!voiceOn) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang === "en-AU") || voices.find(v => v.lang.startsWith("en")) || null;
    u.rate = 1.03;
    speechSynthesis.speak(u);
  }

  /* Voice input */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  if (!SR) {
    micBtn.hidden = true;
  } else {
    rec = new SR();
    rec.lang = "en-AU";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = e => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
    };
    rec.onend = () => {
      listening = false; micBtn.classList.remove("listening"); A.dataset.state = "";
      if (input.value.trim()) send(input.value);
    };
    rec.onerror = () => { listening = false; micBtn.classList.remove("listening"); A.dataset.state = ""; };
    micBtn.addEventListener("click", () => {
      if (listening) { rec.stop(); return; }
      setVoice(true); // talking to it turns spoken replies on
      speechSynthesis?.cancel?.();
      input.value = "";
      try { rec.start(); listening = true; micBtn.classList.add("listening"); A.dataset.state = "listening"; } catch (_) {}
    });
  }
})();
