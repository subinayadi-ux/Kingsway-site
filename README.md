# Kingsway Auto Works website

```
files/                         the website (Cloudflare "Build output directory" = files)
  index.html                   home: scrolling wheel + AI assistant
  services.html                brief list of every service (car icon)
  performance.html             detailed performance page (wrench icon)
  servicing.html               detailed servicing page (gear icon)
  about.html                   contact details (phone icon)
  account.html                 log in, book a service, see schedule (person icon)
  admin.html                   staff-only bookings list (not linked anywhere; go to /admin)
  styles.css, app.js, site.js, account.js, admin.js
functions/api/chat.js          AI assistant
functions/api/account/[[route]].js   log-in, bookings and the servicing schedule
```

## One-time Cloudflare setup for accounts
1. Workers & Pages > KV (under Storage & databases) > Create namespace, name it `kingsway-data`.
2. Your Pages project > Settings > Bindings > Add > KV namespace. Variable name `DB`, namespace `kingsway-data`. Save.
3. Settings > Variables and Secrets > Add a Secret `ADMIN_PASSWORD` (the staff password for /admin).
4. Redeploy (Deployments > ... > Retry deployment).

## Changing the rules
Top of `functions/api/account/[[route]].js`:
- `INTERVAL_MONTHS` (6): time between services
- `GRACE_MONTHS` (2): how late someone can return before reminders stop
- `SERVICE_TYPES`, `WEEKDAY_TIMES`, `SATURDAY_TIMES`: booking form options

## Placeholders to replace
Business name, phone, address, hours and email appear in every .html file (search and replace),
in `data-phone` on each page's <body>, and in `BUSINESS` in `functions/api/chat.js`.
