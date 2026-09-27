(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = ymd => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
  const tel = p => `<a href="tel:${esc(p)}">${esc(p.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3"))}</a>`;
  let key = "";

  async function load() {
    const err = $("#admin-error");
    const res = await fetch("/api/account/admin", { headers: { "x-admin-key": key } }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the server." };
    if (!res || !res.ok) { err.textContent = data.error || "Couldn't load bookings."; $("#admin-view").hidden = true; $("#admin-form").hidden = false; return; }
    err.textContent = "";
    $("#admin-form").hidden = true;
    $("#admin-view").hidden = false;

    const bt = $("#bookings-table");
    bt.innerHTML = data.bookings.length ? `
      <thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Phone</th><th>Service</th><th>Car</th><th>Notes</th><th>Status</th></tr></thead>
      <tbody>${data.bookings.map(b => `<tr class="${b.status === "cancelled" ? "muted" : b.date < data.today ? "past" : ""}">
        <td>${fmt(b.date)}</td><td>${esc(b.time)}</td><td>${esc(b.firstName)}</td><td>${tel(b.phone)}</td>
        <td>${esc(b.serviceType)}</td><td>${esc(b.vehicle)}${b.rego ? `<br><small>${esc(b.rego)}</small>` : ""}</td>
        <td>${esc(b.notes)}</td><td>${b.status === "cancelled" ? "Cancelled" : b.date < data.today ? "Past" : "Booked"}</td></tr>`).join("")}</tbody>`
      : "<tbody><tr><td>No bookings in the last 14 days or coming up.</td></tr></tbody>";

    const statusText = { due: "Overdue", lapsed: "Reminders stopped", active: "Due soon" };
    const ct = $("#customers-table");
    ct.innerHTML = data.customers.length ? `
      <thead><tr><th>Customer</th><th>Phone</th><th>Last service</th><th>Due</th><th>Window closes</th><th>Status</th></tr></thead>
      <tbody>${data.customers.map(c => `<tr><td>${esc(c.firstName)}</td><td>${tel(c.phone)}</td><td>${fmt(c.lastVisit)}</td>
        <td>${fmt(c.expected)}</td><td>${fmt(c.windowEnd)}</td><td>${statusText[c.status]}</td></tr>`).join("")}</tbody>`
      : "<tbody><tr><td>Nobody is due in the next 30 days.</td></tr></tbody>";
  }

  $("#admin-form").addEventListener("submit", e => { e.preventDefault(); key = $("#pw").value; load(); });
  $("#refresh").addEventListener("click", load);
})();
