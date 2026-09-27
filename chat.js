// Cloudflare Pages Function: POST /api/chat
// Requires a secret named ANTHROPIC_API_KEY (Pages project > Settings > Variables and Secrets).
// Optional variable ANTHROPIC_MODEL to override the model.

// ---- Edit these to match the business ----
const BUSINESS = {
  name: "Kingsway Auto Works",
  phone: "(02) 0000 0000",
  address: "1 Example Street, Your Suburb NSW 2000",
  hours: "Mon–Fri 7:30am–5:30pm, Sat 8am–12pm, closed Sunday and public holidays",
  email: "hello@example.com",
  smash: "Panel beating, dent removal, computer-matched paint, chassis measuring and straightening, insurance and private claims.",
  performance: "Dyno testing and tuning, ECU remapping, staged build upgrades (stage 1 intake/exhaust/tune, stage 2 intercooler/fuel, stage 3 turbo), suspension and brake upgrades, diagnosis and parts repair or replacement.",
  servicing: "Logbook, basic and major services (keeps new-car warranty intact), brakes, clutch, suspension, tyres, wheel alignment, air-con re-gas, pre-purchase inspections. Closed Sundays.",
};

const SYSTEM = `You are the website assistant for ${BUSINESS.name}, an Australian automotive workshop.
Services:
- Smash repair: ${BUSINESS.smash}
- Performance enhancements: ${BUSINESS.performance}
- Servicing: ${BUSINESS.servicing}

Online booking and accounts: customers log in at the "My account" page with just their first name and phone number (no password) and can book a service there. After a booked service, their account shows when the next service is due (6 months later), repeating every 6 months. The schedule keeps going as long as they come back within 2 months of each due date; otherwise the reminders stop until they book again. You cannot see or make bookings yourself; send them to the booking page.
Contact: phone ${BUSINESS.phone}, ${BUSINESS.address}, email ${BUSINESS.email}. Hours: ${BUSINESS.hours}.

Your replies may be read aloud, so:
- Keep replies to 1–3 short sentences, plain text, no markdown, no lists, no emoji.
- Friendly, practical Australian English.

You can control the website with tools:
- navigate: when the visitor asks to go to, see, show or open something, or when showing it clearly helps.
  Home page wheel sections (quick overview, stays on this page): home, smash, performance, servicing.
  Other pages: services-page (brief list of every service), performance-page (detail on dyno testing, build stages and parts repair), servicing-page (everything included in a service and how), about-page (contact details, hours, address), account-page (log in, see service schedule), book-service (booking form).
  Prefer book-service when they want to book a service, and the detail pages when they ask how something works.
- call_workshop: only when the visitor explicitly asks to phone or call.
Whenever you use a tool, also write one short sentence saying what you're doing.

Never quote firm prices or promise turnaround times; say the team will confirm after seeing the car, and collect useful details (make, model, year, what happened or what they want). Don't make up stock levels. If a question is unrelated to cars or the workshop, briefly steer back.`;

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
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Sanitise history: last 16 turns, text only, capped length, must start with a user turn
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return json({ error: "No message" }, 400);

  const page = ["home", "smash", "performance", "servicing"].includes(body.page) ? body.page : "home";

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `${SYSTEM}\n\nThe visitor is currently viewing the "${page}" section.`,
      tools: TOOLS,
      messages,
    }),
  });

  if (!upstream.ok) {
    console.error("Anthropic API error", upstream.status, await upstream.text());
    return json({ error: "Upstream error" }, 502);
  }

  const data = await upstream.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  let reply = blocks.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
  const tool = blocks.find(b => b.type === "tool_use");

  let action = null;
  if (tool?.name === "navigate" && tool.input?.section) action = { type: "navigate", section: tool.input.section };
  if (tool?.name === "call_workshop") action = { type: "call" };
  if (!reply) reply = action?.type === "call" ? "Calling the workshop now." : "Here you go.";

  return json({ reply, action });
}
