// Cloudflare Pages Function: /api/account/*
// Needs a KV namespace bound as DB (Pages project > Settings > Bindings).
// Admin page needs a secret called ADMIN_PASSWORD.

// ---- Workshop settings ----
const INTERVAL_MONTHS = 6;   // next service is expected this long after an appointment
const GRACE_MONTHS = 2;      // the schedule keeps recurring if they come back within this long of the due date
const SERVICE_TYPES = ["Logbook service", "Basic service", "Major service"];
const WEEKDAY_TIMES = ["7:30am", "9:00am", "11:00am", "1:00pm", "3:00pm"];
const SATURDAY_TIMES = ["8:00am", "10:00am"];
const MAX_UPCOMING = 3;
const SESSION_DAYS = 90;
const MAX_ATTEMPTS = 8;      // failed logins per phone number per 15 minutes
const COOKIE = "ks_session";

// ---- Router ----
export async function onRequest({ request, env, params }) {
  const route = [].concat(params.route || []).join("/");
  if (!env.DB) return json({ error: "Accounts aren't switched on yet. The workshop needs to connect the DB storage in Cloudflare." }, 503);
  try {
    switch (`${request.method} ${route}`) {
      case "POST login": return await login(request, env);
      case "POST logout": return await logout(request, env);
      case "GET me": return await me(request, env);
      case "POST bookings": return await createBooking(request, env);
      case "POST bookings/cancel": return await cancelBooking(request, env);
      case "GET admin": return await admin(request, env);
      default: return json({ error: "Not found" }, 404);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong on our end. Try again in a moment." }, 500);
  }
}

// ---- Helpers ----
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const readJson = async req => { try { return await req.json(); } catch { return {}; } };

function todaySydney(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addMonths(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, lastDay));
  return t.toISOString().slice(0, 10);
}
const addDays = (ymd, n) => { const t = new Date(ymd + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayOfWeek = ymd => new Date(ymd + "T00:00:00Z").getUTCDay();
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

function normalisePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  return /^0[2-478]\d{8}$/.test(d) ? d : null;
}
function cleanName(raw) {
  const n = String(raw || "").trim().replace(/\s+/g, " ");
  if (!/^\p{L}[\p{L}' -]{0,39}$/u.test(n)) return null;
  return n.charAt(0).toUpperCase() + n.slice(1);
}
const maskPhone = p => `${p.slice(0, 2)}•• ••• ${p.slice(-3)}`;

function getCookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function currentUser(req, env) {
  const token = getCookie(req, COOKIE);
  if (!token || !/^[a-f0-9-]{36,80}$/.test(token)) return null;
  const phone = await env.DB.get("session:" + token);
  if (!phone) return null;
  const user = await env.DB.get("user:" + phone, "json");
  return user ? { user, token } : null;
}

async function bumpAttempts(env, keys) {
  await Promise.all(keys.map(async k => env.DB.put(k, String(Number((await env.DB.get(k)) || 0) + 1), { expirationTtl: 900 })));
}

// ---- The servicing schedule ----
// Each non-cancelled booking counts as a visit. The next service is expected INTERVAL_MONTHS after
// the latest visit and repeats every INTERVAL_MONTHS. A visit within GRACE_MONTHS after a due date
// keeps the chain going; if GRACE_MONTHS pass with no visit, the recurring schedule ends until
// the customer books again, which starts a new chain from that booking.
function computeSchedule(bookings, today) {
  const visits = bookings.filter(b => b.status !== "cancelled").map(b => b.date).sort();
  const base = { intervalMonths: INTERVAL_MONTHS, graceMonths: GRACE_MONTHS };
  if (!visits.length) return { ...base, status: "none" };

  let expected = null, streak = 0;
  for (const d of visits) {
    streak = expected && d <= addMonths(expected, GRACE_MONTHS) ? streak + 1 : 1;
    expected = addMonths(d, INTERVAL_MONTHS);
  }
  const lastVisit = visits[visits.length - 1];
  const previousVisit = [...visits].reverse().find(d => d < today) || null;
  const windowEnd = addMonths(expected, GRACE_MONTHS);
  const recurring = [1, 2, 3].map(k => addMonths(expected, INTERVAL_MONTHS * k));
  const s = { ...base, lastVisit, previousVisit, expected, windowEnd, streak };

  if (lastVisit >= today) return { ...s, status: "booked", upcoming: visits.find(d => d >= today), recurring };
  if (today > windowEnd) return { ...s, status: "lapsed", recurring: [] };
  if (today > expected) return { ...s, status: "due", recurring };
  return { ...s, status: "active", recurring };
}

function profile(user) {
  const today = todaySydney();
  const bookings = [...user.bookings]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(b => ({
      id: b.id, date: b.date, time: b.time, serviceType: b.serviceType, vehicle: b.vehicle, rego: b.rego, notes: b.notes,
      status: b.status === "cancelled" ? "cancelled" : b.date >= today ? "upcoming" : "past",
    }));
  return {
    firstName: user.firstName,
    phone: maskPhone(user.phone),
    today,
    bookings,
    schedule: computeSchedule(user.bookings, today),
    options: { serviceTypes: SERVICE_TYPES, weekdayTimes: WEEKDAY_TIMES, saturdayTimes: SATURDAY_TIMES, minDate: addDays(today, 1), maxDate: addMonths(today, 12) },
  };
}

// ---- Handlers ----
async function login(req, env) {
  const body = await readJson(req);
  const firstName = cleanName(body.firstName);
  const phone = normalisePhone(body.phone);
  if (!firstName || !phone) return json({ error: "Enter your first name and a 10-digit Australian phone number." }, 400);

  const ip = req.headers.get("cf-connecting-ip") || "local";
  const keys = ["attempts:" + phone, "attempts-ip:" + ip];
  const [a, b] = await Promise.all(keys.map(k => env.DB.get(k)));
  if (Number(a) >= MAX_ATTEMPTS || Number(b) >= MAX_ATTEMPTS * 3) return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429);

  let user = await env.DB.get("user:" + phone, "json");
  let created = false;
  if (user && user.firstName.toLowerCase() !== firstName.toLowerCase()) {
    await bumpAttempts(env, keys);
    return json({ error: "That first name doesn't match this phone number. Use the spelling you used when you first logged in." }, 401);
  }
  if (!user) {
    user = { firstName, phone, createdAt: new Date().toISOString(), bookings: [] };
    await env.DB.put("user:" + phone, JSON.stringify(user));
    created = true;
  }
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  await env.DB.put("session:" + token, phone, { expirationTtl: SESSION_DAYS * 86400 });
  return json({ ...profile(user), created }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function logout(req, env) {
  const token = getCookie(req, COOKIE);
  if (token && /^[a-f0-9-]{36,80}$/.test(token)) await env.DB.delete("session:" + token);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function me(req, env) {
  const s = await currentUser(req, env);
  return s ? json(profile(s.user)) : json({ error: "Not logged in." }, 401);
}

async function createBooking(req, env) {
  const s = await currentUser(req, env);
  if (!s) return json({ error: "Your session has ended. Log in again." }, 401);
  const b = await readJson(req);
  const today = todaySydney();

  const date = String(b.date || "");
  if (!validDate(date)) return json({ error: "Choose a date." }, 400);
  if (date <= today) return json({ error: "Choose a date from tomorrow onwards." }, 400);
  if (date > addMonths(today, 12)) return json({ error: "Bookings open up to 12 months ahead." }, 400);
  const dow = dayOfWeek(date);
  if (dow === 0) return json({ error: "We're closed on Sundays. Choose another day." }, 400);
  const times = dow === 6 ? SATURDAY_TIMES : WEEKDAY_TIMES;
  if (!times.includes(b.time)) return json({ error: "Choose a drop-off time." }, 400);
  if (!SERVICE_TYPES.includes(b.serviceType)) return json({ error: "Choose a service." }, 400);
  const vehicle = String(b.vehicle || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (vehicle.length < 2) return json({ error: "Tell us the make and model of your car." }, 400);
  const rego = String(b.rego || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9);
  const notes = String(b.notes || "").trim().slice(0, 500);

  const user = s.user;
  const upcoming = user.bookings.filter(x => x.status !== "cancelled" && x.date >= today);
  if (upcoming.length >= MAX_UPCOMING) return json({ error: `You already have ${MAX_UPCOMING} upcoming bookings. Cancel one or call us.` }, 400);
  if (upcoming.some(x => x.date === date)) return json({ error: "You already have a booking on that day." }, 400);

  const id = crypto.randomUUID().slice(0, 8);
  user.bookings.push({ id, date, time: b.time, serviceType: b.serviceType, vehicle, rego, notes, status: "booked", createdAt: new Date().toISOString() });
  await env.DB.put("user:" + user.phone, JSON.stringify(user));
  return json({ ...profile(user), booked: id });
}

async function cancelBooking(req, env) {
  const s = await currentUser(req, env);
  if (!s) return json({ error: "Your session has ended. Log in again." }, 401);
  const { id } = await readJson(req);
  const booking = s.user.bookings.find(x => x.id === id);
  if (!booking || booking.status === "cancelled") return json({ error: "That booking wasn't found." }, 404);
  if (booking.date <= todaySydney()) return json({ error: "Bookings can't be cancelled online on the day. Give us a call." }, 400);
  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  await env.DB.put("user:" + s.user.phone, JSON.stringify(s.user));
  return json(profile(s.user));
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map(x => crypto.subtle.digest("SHA-256", enc.encode(x))));
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function admin(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Add an ADMIN_PASSWORD secret in Cloudflare first." }, 503);
  const ipKey = "admin-attempts:" + (req.headers.get("cf-connecting-ip") || "local");
  if (Number(await env.DB.get(ipKey)) >= 10) return json({ error: "Too many attempts. Wait 15 minutes." }, 429);
  if (!(await sameSecret(req.headers.get("x-admin-key") || "", env.ADMIN_PASSWORD))) {
    await bumpAttempts(env, [ipKey]);
    return json({ error: "Wrong password." }, 401);
  }

  const names = [];
  let cursor;
  do {
    const page = await env.DB.list({ prefix: "user:", cursor });
    names.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const users = (await Promise.all(names.map(n => env.DB.get(n, "json")))).filter(Boolean);

  const today = todaySydney();
  const from = addDays(today, -14);
  const soon = addDays(today, 30);
  const bookings = [], customers = [];
  for (const u of users) {
    for (const b of u.bookings) {
      if (b.date >= from) bookings.push({ ...b, firstName: u.firstName, phone: u.phone });
    }
    const s = computeSchedule(u.bookings, today);
    if (s.status === "due" || s.status === "lapsed" || (s.status === "active" && s.expected <= soon)) {
      customers.push({ firstName: u.firstName, phone: u.phone, status: s.status, lastVisit: s.lastVisit, expected: s.expected, windowEnd: s.windowEnd });
    }
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date));
  customers.sort((a, b) => a.expected.localeCompare(b.expected));
  return json({ today, bookings, customers });
}
