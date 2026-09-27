(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toDate = ymd => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtLong = ymd => toDate(ymd).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const fmt = ymd => toDate(ymd).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtDay = ymd => toDate(ymd).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const dow = ymd => toDate(ymd).getUTCDay();

  async function api(path, body) {
    try {
      const res = await fetch("/api/account/" + path, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: "Can't reach the workshop right now. Check your connection and try again." } };
    }
  }

  const notice = $("#acct-notice"), loginView = $("#login-view"), dashView = $("#dash-view");
  let profile = null;

  function showNotice(msg) { notice.textContent = msg; notice.hidden = !msg; }
  function showLogin() {
    showNotice("");
    dashView.hidden = true;
    loginView.hidden = false;
    $("#acct-lede").hidden = false;
    $("#fn").focus({ preventScroll: true });
  }

  /* ---------- Login ---------- */
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#login-error"), btn = e.submitter || e.target.querySelector("button");
    const firstName = $("#fn").value.trim(), phone = $("#ph").value.trim();
    if (!firstName) return (err.textContent = "Enter your first name.");
    if (phone.replace(/\D/g, "").length < 10) return (err.textContent = "Enter your 10-digit phone number.");
    err.textContent = ""; btn.disabled = true;
    const r = await api("login", { firstName, phone });
    btn.disabled = false;
    if (!r.ok) return (err.textContent = r.data.error || "Couldn't log in. Try again.");
    showDash(r.data, r.data.created ? "Your account is set up. Book a service below to start your schedule." : "");
    if (location.hash === "#book" || r.data.created) $("#book").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#logout").addEventListener("click", async () => {
    await api("logout", {});
    profile = null;
    $("#login-form").reset();
    showLogin();
  });

  /* ---------- Dashboard ---------- */
  function showDash(p, message = "") {
    profile = p;
    showNotice(message);
    loginView.hidden = true;
    dashView.hidden = false;
    $("#acct-lede").hidden = true;
    $("#hello").textContent = `Hi, ${p.firstName}`;
    $("#who").textContent = `Logged in with ${p.phone}`;
    renderSchedule(p.schedule);
    renderBookings(p.bookings);
    setupForm(p.options);
  }

  function renderSchedule(s) {
    const line = $("#status-line"), sub = $("#status-sub"), tl = $("#timeline");
    const items = [];
    const every = `every ${s.intervalMonths} months`;
    const grace = d => `<span class="grace">Keep your schedule by coming in before ${fmt(d)}</span>`;
    const addRecurring = () => s.recurring.forEach((d, i) =>
      items.push({ kind: "future", date: d, title: i === 0 ? `Then ${every}` : "", detail: i === 0 ? "As long as you keep coming back" : "" }));

    switch (s.status) {
      case "none":
        line.textContent = "No services booked yet.";
        sub.textContent = "Book your first service and we'll work out when your next one is due.";
        break;
      case "booked":
        line.textContent = `Your next service is booked for ${fmtLong(s.upcoming)}.`;
        sub.textContent = `After that, we'll expect you back around ${fmt(s.expected)}, then ${every}.`;
        if (s.previousVisit) items.push({ kind: "past", date: s.previousVisit, title: "Last service" });
        items.push({ kind: "booked", date: s.upcoming, title: "Booked" });
        if (s.lastVisit !== s.upcoming) items.push({ kind: "booked", date: s.lastVisit, title: "Also booked" });
        items.push({ kind: "due", date: s.expected, title: "Next service due", extra: grace(s.windowEnd) });
        addRecurring();
        break;
      case "active":
        line.textContent = `Your next service is due around ${fmtLong(s.expected)}.`;
        sub.textContent = `Book any time before ${fmt(s.windowEnd)} to keep your reminders going.`;
        items.push({ kind: "past", date: s.lastVisit, title: "Last service" });
        items.push({ kind: "due", date: s.expected, title: "Next service due", extra: grace(s.windowEnd) });
        addRecurring();
        break;
      case "due":
        line.textContent = `Your service was due on ${fmtLong(s.expected)}.`;
        sub.textContent = `Book before ${fmt(s.windowEnd)} and your schedule carries on as normal.`;
        items.push({ kind: "past", date: s.lastVisit, title: "Last service" });
        items.push({ kind: "due overdue", date: s.expected, title: "Service due", extra: grace(s.windowEnd) });
        addRecurring();
        break;
      case "lapsed":
        line.textContent = "Your service reminders have stopped.";
        sub.textContent = `We haven't seen you since ${fmt(s.lastVisit)}. Book a service and your schedule starts again from that date.`;
        items.push({ kind: "past", date: s.lastVisit, title: "Last service" });
        items.push({ kind: "missed", date: s.expected, title: "Service was due" });
        items.push({ kind: "end", date: s.windowEnd, title: "Reminders stopped", detail: `No visit within ${s.graceMonths} months of the due date` });
        break;
    }
    tl.innerHTML = items.map(i => `
      <li class="tl ${i.kind}">
        <span class="tl-date">${fmt(i.date)}</span>
        <span class="tl-body">${i.title ? `<strong>${esc(i.title)}</strong>` : ""}${i.detail ? `<span>${esc(i.detail)}</span>` : ""}${i.extra || ""}</span>
      </li>`).join("");
    tl.hidden = !items.length;
  }

  function renderBookings(list) {
    const el = $("#bookings");
    if (!list.length) { el.innerHTML = '<p class="hint">Nothing yet. Your bookings will show here.</p>'; return; }
    const label = { upcoming: "Upcoming", past: "Past", cancelled: "Cancelled" };
    el.innerHTML = list.map(b => `
      <div class="bk ${b.status}">
        <div class="bk-date">${esc(fmtDay(b.date))}<span>${esc(b.date.slice(0, 4))}, ${esc(b.time)}</span></div>
        <div class="bk-info"><strong>${esc(b.serviceType)}</strong><span>${esc(b.vehicle)}${b.rego ? ", " + esc(b.rego) : ""}</span><em class="pill">${label[b.status]}</em></div>
        ${b.status === "upcoming" && b.date > profile.today ? `<button class="text-btn" type="button" data-cancel="${esc(b.id)}">Cancel</button>` : ""}
      </div>`).join("");
  }

  $("#bookings").addEventListener("click", async e => {
    const id = e.target.closest("[data-cancel]")?.dataset.cancel;
    if (!id || !confirm("Cancel this booking?")) return;
    const r = await api("bookings/cancel", { id });
    if (r.status === 401) return showLogin();
    if (!r.ok) return alert(r.data.error || "Couldn't cancel. Give us a call.");
    showDash(r.data, "Booking cancelled.");
  });

  /* ---------- Booking form ---------- */
  let formReady = false;
  function setupForm(o) {
    const type = $("#bk-type"), date = $("#bk-date");
    if (!formReady) {
      type.innerHTML = o.serviceTypes.map(t => `<option>${esc(t)}</option>`).join("");
      date.addEventListener("change", () => fillTimes(o));
      formReady = true;
    }
    date.min = o.minDate; date.max = o.maxDate;
    fillTimes(o);
  }
  function fillTimes(o) {
    const time = $("#bk-time"), d = $("#bk-date").value, err = $("#book-error");
    const sunday = d && dow(d) === 0;
    const times = d && dow(d) === 6 ? o.saturdayTimes : o.weekdayTimes;
    const prev = time.value;
    time.innerHTML = times.map(t => `<option${t === prev ? " selected" : ""}>${esc(t)}</option>`).join("");
    time.disabled = sunday;
    err.textContent = sunday ? "We're closed on Sundays. Choose another day." : "";
  }

  $("#book-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#book-error"), btn = e.target.querySelector('button[type="submit"]');
    const body = {
      serviceType: $("#bk-type").value, date: $("#bk-date").value, time: $("#bk-time").value,
      vehicle: $("#bk-vehicle").value.trim(), rego: $("#bk-rego").value.trim(), notes: $("#bk-notes").value.trim(),
    };
    if (!body.date) return (err.textContent = "Choose a date.");
    if (dow(body.date) === 0) return (err.textContent = "We're closed on Sundays. Choose another day.");
    if (body.vehicle.length < 2) return (err.textContent = "Tell us the make and model of your car.");
    err.textContent = ""; btn.disabled = true;
    const r = await api("bookings", body);
    btn.disabled = false;
    if (r.status === 401) return showLogin();
    if (!r.ok) return (err.textContent = r.data.error || "Couldn't book. Try again or call us.");
    e.target.reset();
    showDash(r.data, `Booked for ${fmtLong(body.date)} at ${body.time}. We'll call you to confirm.`);
    $("#schedule").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Start ---------- */
  (async () => {
    const r = await api("me");
    if (r.ok) {
      showDash(r.data);
      if (location.hash === "#book") setTimeout(() => $("#book").scrollIntoView({ block: "start" }), 50);
    } else if (r.status === 401) showLogin();
    else showNotice(r.data.error || "Accounts aren't available right now. Give us a call to book.");
  })();
})();
