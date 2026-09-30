// Cloudflare Pages Function: POST /api/chat
// Needs: secret ANTHROPIC_API_KEY. Optional: variable ANTHROPIC_MODEL, KV binding DB (to save quote requests).
// Prices come from /price-guide.md at the top level of the site. Edit that file, not this one.

// ---- Edit these to match the business ----
const BUSINESS = {
  name: "Kingsway Auto Works",
  phone: "(02) 0000 0000",
  address: "1 Example Street, Your Suburb NSW 2000",
  hours: "Mon–Fri 7:30am–5:30pm, Sat 8am–12pm, closed Sunday and public holidays",
  email: "hello@example.com",
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ROUNDS = 4;

// ---- Helpers ----
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function todaySydney(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const addDays = (ymd, n) => { const t = new Date(ymd + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const isWorkingDay = ymd => { const d = new Date(ymd + "T00:00:00Z").getUTCDay(); return d >= 1 && d <= 5; };
function addWorkingDays(ymd, n) {
  let d = ymd;
  while (n > 0) { d = addDays(d, 1); if (isWorkingDay(d)) n--; }
  return d;
}
const nextWorkingDay = ymd => addWorkingDays(ymd, 1);
const longDate = ymd => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function normalisePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  return /^0[2-478]\d{8}$/.test(d) ? d : null;
}
function cleanName(raw) {
  const n = String(raw || "").trim().replace(/\s+/g, " ");
  return /^\p{L}[\p{L}' -]{0,39}$/u.test(n) ? n.charAt(0).toUpperCase() + n.slice(1) : null;
}
const clip = (s, n) => String(s || "").trim().replace(/\s+/g, " ").slice(0, n);
const money = n => "$" + Math.round(n).toLocaleString("en-AU");

// ---- Price guide (cached for 5 minutes per server instance) ----
let guideCache = { text: null, at: 0 };
async function loadPriceGuide(request, env) {
  if (guideCache.text !== null && Date.now() - guideCache.at < 300000) return guideCache.text;
  let text = "";
  try {
    const res = await env.ASSETS.fetch(new URL("/price-guide.md", request.url));
    if (res.ok) text = (await res.text()).slice(0, 20000);
  } catch (e) { console.error("Price guide not loaded", e); }
  guideCache = { text, at: Date.now() };
  return text;
}
const guideConfirmed = guide => /confirmed by workshop:\s*yes/i.test(guide);

// ---- System prompt ----
function buildSystem(guide, today, page) {
  const pricing = guide
    ? `PRICE GUIDE (the only source of prices and times you may use):
<price_guide>
${guide}
</price_guide>
${guideConfirmed(guide) ? "" : "The workshop has NOT confirmed these prices yet. Whenever you give an estimate, say briefly that the figures are samples for now.\n"}`
    : "No price guide is available right now. Don't give any prices or times; offer to send a quote request or suggest calling.\n";

  return `You are the website assistant for ${BUSINESS.name}, an Australian automotive workshop doing smash repair, performance work and servicing.
Contact: phone ${BUSINESS.phone}, ${BUSINESS.address}, email ${BUSINESS.email}. Hours: ${BUSINESS.hours}.
Today is ${longDate(today)} (Sydney). The visitor is viewing the "${page}" section of the home page.

${pricing}
ESTIMATES
- When someone asks what a job costs or how long it takes, and you know enough to match it to the price guide, call show_estimate. It displays a clear card to the customer with the price range, turnaround and dates.
- If you need one or two details first (car size, which axle, how many panels, whether the paint is damaged), ask before estimating. Ask one question at a time.
- Every line in show_estimate must come from the price guide, using its figures unchanged. For "from $X" items with no upper figure, leave max out. Never go below a guide minimum and never invent a job that isn't listed.
- Use unit "hours" for same-day jobs, "days" for working days, "weeks" for long jobs.
- List the assumptions you made (e.g. "Small or medium car", "Front axle only") and anything not included (e.g. "Parts for the exhaust", "Tyres").
- Always make clear it's a guide, not a quote: the workshop confirms the price after seeing the car. For smash repair, mention that photos or an inspection are needed, and insurance jobs can take longer.
- If the job isn't in the guide, or it's too vague to match, don't estimate. Explain briefly and offer to send the details to the workshop as a quote request.
- If the customer describes something unsafe (grinding or failing brakes, steering problems, smoke, overheating, a flashing engine light), tell them not to drive it and to call the workshop.

QUOTE REQUESTS
- If a customer wants a firm quote or wants the workshop to look into a specific issue, collect: first name, phone number, the car (make, model, year) and a short description of the problem.
- Read the details back in one sentence and ask them to confirm. Only after they confirm, call submit_quote_request. Tell them their reference number and that the workshop will call during business hours.

WEBSITE
- navigate: home page sections (home, smash, performance, servicing) or pages (services-page, performance-page, servicing-page, about-page, account-page, book-service). Use book-service when they want to book a service.
- call_workshop: only when they explicitly ask to phone.
- Customers log in on the My account page with their first name and phone number to book services and see when their next service is due (6 months after each service, carrying on if they return within 2 months of each due date).

STYLE
Your replies may be read aloud: 1 to 3 short sentences, plain text, no markdown, no lists, no emoji. Friendly, practical Australian English. When you show an estimate card, don't repeat all its figures; give a one-sentence summary. If a question has nothing to do with cars or the workshop, steer back briefly.`;
}

// ---- Tools ----
const TOOLS = [
  {
    name: "navigate",
    description: "Show a section of the home page wheel, or open another page of the website.",
    input_schema: {
      type: "object",
      properties: { section: { type: "string", enum: ["home", "smash", "performance", "servicing", "services-page", "performance-page", "servicing-page", "about-page", "account-page", "book-service"] } },
      required: ["section"],
    },
  },
  {
    name: "call_workshop",
    description: "Start a phone call to the workshop from the visitor's device.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "show_estimate",
    description: "Show the customer a rough price and turnaround estimate card, using only figures from the price guide.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name for the job, e.g. 'Front brake pads and rotors'" },
        category: { type: "string", enum: ["servicing", "smash", "performance", "diagnosis"] },
        lines: {
          type: "array", minItems: 1, maxItems: 6,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              min: { type: "number", description: "Lowest price in AUD incl. GST, from the guide" },
              max: { type: "number", description: "Highest price in AUD, from the guide. Omit for 'from' prices." },
            },
            required: ["label", "min"],
          },
        },
        time_min: { type: "number" },
        time_max: { type: "number" },
        time_unit: { type: "string", enum: ["hours", "days", "weeks"] },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 4 },
        not_included: { type: "array", items: { type: "string" }, maxItems: 4 },
      },
      required: ["title", "category", "lines", "time_min", "time_max", "time_unit"],
    },
  },
  {
    name: "submit_quote_request",
    description: "Send a quote request to the workshop. Only call after the customer has confirmed their details.",
    input_schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        phone: { type: "string" },
        vehicle: { type: "string", description: "Make, model and year" },
        details: { type: "string", description: "What the customer wants done or what's wrong, in their words" },
        estimate_given: { type: "string", description: "The rough estimate already shown, if any" },
      },
      required: ["first_name", "phone", "vehicle", "details"],
    },
  },
];

// ---- Tool handlers ----
function buildEstimate(input, today, sample) {
  const num = v => (typeof v === "number" && isFinite(v) ? v : NaN);
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 6).map(l => {
    const min = num(l.min), max = num(l.max);
    if (!(min > 0 && min <= 200000)) return null;
    return { label: clip(l.label, 80) || "Item", min: Math.round(min), max: max >= min && max <= 200000 ? Math.round(max) : null };
  });
  if (!lines.length || lines.includes(null)) return null;

  const tMin = Math.round(num(input.time_min)), tMax = Math.round(num(input.time_max));
  const unit = ["hours", "days", "weeks"].includes(input.time_unit) ? input.time_unit : null;
  if (!unit || !(tMin > 0) || !(tMax >= tMin) || tMax > (unit === "hours" ? 12 : unit === "days" ? 30 : 12)) return null;

  const dropOff = nextWorkingDay(today);
  let readyFrom, readyTo;
  if (unit === "hours") readyFrom = readyTo = dropOff;
  else {
    const wd = n => (unit === "weeks" ? n * 5 : n);
    // A 1-day job dropped off in the morning is usually ready that afternoon
    readyFrom = addWorkingDays(dropOff, wd(tMin) - 1);
    readyTo = addWorkingDays(dropOff, wd(tMax) - 1);
  }

  const totalMin = lines.reduce((s, l) => s + l.min, 0);
  const totalMax = lines.every(l => l.max) ? lines.reduce((s, l) => s + l.max, 0) : null;
  return {
    title: clip(input.title, 60) || "Estimate",
    category: input.category,
    lines, totalMin, totalMax,
    time: { min: tMin, max: tMax, unit, dropOff, readyFrom, readyTo },
    assumptions: (input.assumptions || []).slice(0, 4).map(s => clip(s, 120)).filter(Boolean),
    notIncluded: (input.not_included || []).slice(0, 4).map(s => clip(s, 120)).filter(Boolean),
    sample,
  };
}
const summariseEstimate = e =>
  `${e.title}: from ${money(e.totalMin)}${e.totalMax ? ` to ${money(e.totalMax)}` : ""}, ${e.time.min}${e.time.max !== e.time.min ? `–${e.time.max}` : ""} ${e.time.unit}`;

async function saveQuoteRequest(input, env, request) {
  const firstName = cleanName(input.first_name);
  const phone = normalisePhone(input.phone);
  const vehicle = clip(input.vehicle, 80);
  const details = clip(input.details, 1000);
  if (!firstName) return { ok: false, message: "Not saved: ask for their first name." };
  if (!phone) return { ok: false, message: "Not saved: the phone number isn't a valid 10-digit Australian number. Ask them to check it." };
  if (vehicle.length < 2 || details.length < 5) return { ok: false, message: "Not saved: ask for the car and a short description of the issue." };
  if (!env.DB) return { ok: false, message: `Not saved: requests can't be stored right now. Ask them to call ${BUSINESS.phone}.` };

  const ipKey = "quote-ip:" + (request.headers.get("cf-connecting-ip") || "local");
  const count = Number(await env.DB.get(ipKey)) || 0;
  if (count >= 5) return { ok: false, message: `Not saved: too many requests from this device. Ask them to call ${BUSINESS.phone}.` };

  const ref = "Q-" + crypto.randomUUID().slice(0, 6).toUpperCase();
  const record = { ref, firstName, phone, vehicle, details, estimate: clip(input.estimate_given, 300), createdAt: new Date().toISOString(), status: "new" };
  await Promise.all([
    env.DB.put(`quote:${Date.now()}-${ref}`, JSON.stringify(record), { expirationTtl: 365 * 86400 }),
    env.DB.put(ipKey, String(count + 1), { expirationTtl: 3600 }),
  ]);
  return { ok: true, ref, message: `Saved with reference ${ref}. Tell the customer the reference and that the workshop will call them during business hours.` };
}

// ---- Handler ----
export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return json({ error: "No message" }, 400);

  const page = ["home", "smash", "performance", "servicing"].includes(body.page) ? body.page : "home";
  const today = todaySydney();
  const guide = await loadPriceGuide(request, env);
  const system = buildSystem(guide, today, page);

  let action = null, estimate = null, quote = null;
  const texts = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || MODEL, max_tokens: 800, system, tools: TOOLS, messages }),
    });
    if (!res.ok) {
      console.error("Anthropic API error", res.status, await res.text());
      if (texts.length || estimate) break; // keep what we already have
      return json({ error: "Upstream error" }, 502);
    }
    const data = await res.json();
    const blocks = Array.isArray(data.content) ? data.content : [];
    texts.push(...blocks.filter(b => b.type === "text").map(b => b.text.trim()).filter(Boolean));

    const uses = blocks.filter(b => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || !uses.length) break;

    const results = [];
    for (const u of uses) {
      let out = "Done.", isError = false;
      const input = u.input || {};
      if (u.name === "navigate") {
        action = { type: "navigate", section: input.section };
        out = "The page will change after your reply.";
      } else if (u.name === "call_workshop") {
        action = { type: "call" };
        out = "The call will start after your reply.";
      } else if (u.name === "show_estimate") {
        const e = buildEstimate(input, today, !guideConfirmed(guide));
        if (e) {
          estimate = e;
          out = `Card shown: ${summariseEstimate(e)}. If dropped off ${longDate(e.time.dropOff)}, likely ready ${e.time.readyFrom === e.time.readyTo ? longDate(e.time.readyFrom) : `between ${longDate(e.time.readyFrom)} and ${longDate(e.time.readyTo)}`}. Now give a one-sentence summary.`;
        } else {
          out = "Estimate rejected: prices must be positive numbers from the guide and times must be sensible. Fix it or don't estimate.";
          isError = true;
        }
      } else if (u.name === "submit_quote_request") {
        const r = await saveQuoteRequest(input, env, request);
        if (r.ok) quote = { ref: r.ref };
        out = r.message;
        isError = !r.ok;
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: out, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "assistant", content: blocks }, { role: "user", content: results });
  }

  let reply = texts.join(" ").trim();
  if (!reply) reply = estimate ? "Here's a rough estimate." : quote ? `Sent. Your reference is ${quote.ref}.` : action?.type === "call" ? "Calling the workshop now." : "Here you go.";
  return json({ reply, action, estimate, quote, historyNote: estimate ? `[Estimate shown to customer: ${summariseEstimate(estimate)}]` : "" });
}
