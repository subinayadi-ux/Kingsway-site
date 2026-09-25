# Kingsway Auto Works – Cloudflare Pages site

```
index.html            page markup, ribbon, wheel, panels, about, assistant
styles.css            all styling
app.js                scroll-driven wheel + assistant (text + voice)
functions/api/chat.js Pages Function that calls the Claude API
```

## Deploy
1. `npx wrangler pages deploy .` from this folder (or push the folder to GitHub and connect it in Cloudflare Pages; build command: none, output directory: `/`).
   Note: drag-and-drop upload in the dashboard does not deploy the `functions` folder.
2. In the Pages project: Settings > Variables and Secrets, add a **Secret** `ANTHROPIC_API_KEY`. Redeploy.
3. Optional variable `ANTHROPIC_MODEL` to change model.

## Local testing
Create `.dev.vars` containing `ANTHROPIC_API_KEY=sk-ant-...`, then run `npx wrangler pages dev .`
(Don't commit `.dev.vars`.)

## Replace placeholders
- Business name: `index.html` (title, brand) and `BUSINESS` in `functions/api/chat.js`
- Phone: `data-phone` on `<body>`, the `tel:` link and number in the About section, and `BUSINESS.phone`
- Address, hours, email: About section and `BUSINESS`

## Notes
- Without the API key, the assistant still navigates using keyword matching.
- Voice input uses the browser's speech recognition (Chrome, Edge, Safari). Firefox hides the mic button.
- The endpoint is public: add Cloudflare rate limiting or Turnstile before heavy traffic, since every message costs API usage.
