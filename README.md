# Jinke: e-commerce portal and admin dashboard

An online store for lifestyle apparel and merchandise, with an admin dashboard for running it. It's built with Node.js, Express and SQLite, the database that ships with Node, so there's no separate database server or build step.

## Try it on your computer

```bash
npm install
npm start          # http://localhost:3000
```

- Storefront: http://localhost:3000
- Admin: http://localhost:3000/admin. Log in with **admin@jinke.store / admin123**. This is demo mode only.

Every fresh install loads the Jinke catalogue: categories, collections, banners, and the 6 launch products with their photos (from `lib/seed-assets/`). Demo mode also adds sample orders, customers, reviews and a coupon so every screen has something to show. `npm run seed` reloads everything. You need Node 22.13 or newer.

---

## Launch checklist

| # | Step | Where |
|---|------|-------|
| 1 | Buy a domain and a small server, for example a 1 GB VPS (DigitalOcean, Hetzner, AWS Lightsail). | — |
| 2 | Deploy with HTTPS. The live store starts with the Jinke catalogue and no demo orders. | [Deploy](#deploy) |
| 3 | Log in to the admin and change the password if one was generated for you. | Admin → Settings |
| 4 | Fill in the store name, logo, contact details, business name, GSTIN and grievance officer. | Admin → Settings |
| 5 | Read and adjust the five policy pages. Have a lawyer or CA review them. | Admin → Policy pages |
| 6 | Add categories, collections, products with photos and stock, and home banners. | Admin |
| 7 | Set up order emails and send a test email. | [Order emails](#order-emails) |
| 8 | Connect Razorpay with test keys and try a test payment. | [Online payments](#online-payments-razorpay) |
| 9 | Switch to live Razorpay keys and place one real order with a small amount. | Admin → Settings |
| 9a | Optional: turn on GST invoices, Shiprocket, WhatsApp and SMS alerts. | [Integrations](#integrations-optional) |
| 10 | Copy backups off the server. | [Backups](#backups) |
| 11 | Add the site to Google Search Console and submit `https://yourdomain/sitemap.xml`. | search.google.com/search-console |

---

## Deploy

### Option V: Vercel (with Turso + Vercel Blob)
Vercel runs the store as a serverless function with no disk, so the store keeps its data in two online services instead:
- **Turso** (an online SQLite database) holds orders, products, customers and settings.
- **Vercel Blob** holds the photos you upload in the admin. The launch photos are part of the code in `public/assets/products/`.

1. **Database:** create a Turso database. The easiest way is in Vercel: open the project, go to **Storage → Create Database → Turso**, pick the **Mumbai (ap-south-1)** region, and connect it to the project. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for you.
   You can also sign up at turso.tech, create a database in Mumbai, and copy its URL (`libsql://…`) and a token into the environment variables yourself.
2. **Photos:** in Vercel, go to **Storage → Create → Blob** and connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`.
3. **Environment variables:** under **Settings → Environment Variables**, add:
   - `ADMIN_EMAIL` = jinke.wear@gmail.com
   - `ADMIN_PASSWORD` = your admin password
   - `PUBLIC_URL` = https://your-project.vercel.app (later your own domain)
   - `CRON_SECRET` = any long random text. It protects the daily background job.
4. **Deploy:** go to **Deployments → Redeploy**, or push to GitHub. On the first visit the store creates its tables and loads the Jinke catalogue.
5. Open `/admin` and log in.

Notes:
- **Plan:** Vercel's free Hobby plan is for non-commercial use only. A store selling products needs **Vercel Pro**.
- **Background jobs:** `vercel.json` runs the background job (releasing unpaid online orders, courier tracking) once a day, the most the Hobby plan allows. It also runs whenever you open the admin dashboard. On Pro you can make it more frequent, e.g. `*/10 * * * *`.
- **Region:** the function runs in Mumbai (`bom1`, set in `vercel.json`). Keep the Turso database in the same region so pages load quickly.
- **Uploads:** photo uploads are limited to 4 MB each, because Vercel caps a request at 4.5 MB.
- **If something goes wrong:** look at **Vercel → the deployment → Logs**. If `TURSO_DATABASE_URL` is missing, the log says so in plain words.

> The same code also runs on an ordinary server with a local database file. The options below need no Turso or Blob.

Everything the store saves lives in **one folder, `/app/data`** (database, photos you upload, daily backups). Whichever host you use, attach a persistent disk there.

### Option A: Render (easiest, about $7/month + disk)
1. Put this project in a GitHub repository.
2. In Render, go to **New → Blueprint** and pick the repository. Render reads `render.yaml`: a Docker web service with a 1 GB disk at `/app/data` and a health check.
3. When asked, set `ADMIN_PASSWORD` and `PUBLIC_URL` (e.g. `https://jinke-store.onrender.com`; change it to your domain later).
4. Deploy, then open `https://<your-app>.onrender.com/admin` and log in as jinke.wear@gmail.com.
5. Custom domain: in Render go to **Settings → Custom Domains**, add your domain, and add the DNS record Render shows. HTTPS is automatic.

### Option B: Railway (about $5/month)
1. Create a project from the GitHub repository, or run `railway up` with the Railway CLI. `railway.json` tells Railway to build the Dockerfile and use `/healthz`.
2. Add a **Volume** to the service mounted at **`/app/data`**.
3. Under **Variables**, add `ADMIN_EMAIL=jinke.wear@gmail.com`, `ADMIN_PASSWORD=…` and `PUBLIC_URL=https://…`.
4. Generate a domain (or add yours) under **Settings → Networking**.

### Option C: Your own server (VPS) with Docker and automatic HTTPS
This needs a Linux server with Docker installed, and your domain's DNS **A record** pointing to the server's IP.

```bash
git clone <your repo> store && cd store      # or copy this folder to the server
cp .env.example .env && nano .env            # set DOMAIN, PUBLIC_URL, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
docker compose logs app | grep -A3 "Admin login"   # shows the password if you left ADMIN_PASSWORD empty
```
Caddy gets and renews the HTTPS certificate automatically. Your data lives in `./data` on the server. To update to newer code, run `docker compose up -d --build` again; your data is not touched.

### Option D: Plain Node.js (no Docker)
```bash
npm ci --omit=dev
cp .env.example .env && nano .env
npm start      # keep it running with pm2: pm2 start npm --name store -- start
```
Put it behind a web server that handles HTTPS, such as Caddy (`reverse_proxy localhost:3000`) or nginx.

### What happens in production mode (`NODE_ENV=production`)
- On the first start, the store loads **your catalogue only**: no demo orders, customers or reviews, and **no default password**. The admin login is `ADMIN_EMAIL` (default jinke.wear@gmail.com). The password comes from `ADMIN_PASSWORD`, or a random one is printed once in the logs.
- Check the launch products' prices, stock (it starts at 20 per size) and descriptions in Admin → Products before going live.
- Pages are served with caching suited to production.
- To wipe a store you've been testing with and start again from the catalogue, without demo orders: `npm run reset:empty`. ⚠️ This deletes all orders, customers and changes.

---

## Online payments (Razorpay)
1. In the Razorpay Dashboard, go to **Account & Settings → API Keys** and generate a key. Start with **test mode** keys (`rzp_test_…`).
2. In the admin, go to **Settings → Razorpay** and paste in the **Key ID** and **Key secret**.
3. In the Razorpay Dashboard, go to **Webhooks** and add `https://yourdomain/api/razorpay/webhook`. Subscribe it to the events `payment.captured` and `order.paid`, and paste the same secret into Settings.

When it activates your account, Razorpay checks your website for a Privacy Policy, Terms, Refund Policy, Shipping Policy and Contact page. These are already at `/pages/...` and linked in the footer.

How payments work:
- The order is created, and its stock is held, before the customer pays.
- An order is marked paid only after Razorpay's confirmation checks out, whether it arrives from the customer's browser or from the webhook.
- If an order is still unpaid after 30 minutes, it is cancelled and its stock is released. A payment that arrives later reopens the order.

## Order emails
In the admin, go to **Settings → Order emails** and enter your email provider's SMTP details. With Gmail, use `smtp.gmail.com`, port `587` and an [App Password](https://myaccount.google.com/apppasswords). Then send a test email.

Once set up, the store sends:
- order confirmations to customers
- shipped, delivered and cancelled updates to customers
- a new-order alert to your store email
- password reset links

## Integrations (optional)
Everything below is already built in and stays off until you switch it on in **Admin → Integrations**. Each section on that page has step-by-step setup instructions, a status badge and a test button.

| Integration | What it does | What you need |
|---|---|---|
| **GST** | As soon as you save your GSTIN (Settings → Business details; the state is read from it), the cart and checkout show the GST included in the price. Business buyers can tick "I need a GST invoice for my business" and enter their GSTIN. It's checked, saved on the order (marked B2B in the admin) and printed on their tax invoice. Bulk enquiries can include a GSTIN too. | Your GSTIN |
| **GST invoices** | Creates a printable tax invoice (A4, save as PDF) when an order ships. It includes HSN codes, CGST + SGST for buyers in your state and IGST for other states, and invoice numbers that run in sequence per financial year (`INV/2026-27/0001`). Customers can open theirs from the tracking page and the shipping email. | Your GSTIN, entered in Settings. Set a GST rate and HSN code per product, or use the store default. Check the rates with your CA. |
| **Shiprocket** | A **Ship with Shiprocket** button on each order. It creates the shipment, assigns the recommended courier, schedules pickup and generates the label. Courier tracking updates move the order to Delivered and mark cash-on-delivery orders as paid automatically. | A Shiprocket account with KYC done and wallet funds, an API user, and a pickup address. Add the webhook URL and token shown in the admin. |
| **WhatsApp** | Order placed, shipped, delivered and cancelled messages to customers, and new-order alerts to you. Uses the official WhatsApp Business Platform (Meta Cloud API). | A Meta business app with a WhatsApp number, a permanent access token, and message templates approved by Meta. The admin page suggests the wording. |
| **SMS (MSG91)** | The same order updates by SMS. | A MSG91 account, DLT registration, and one template ("flow") per message. |

Every WhatsApp and SMS message is logged. Each order shows what was sent and whether it was delivered, and you can resend from there.

If a WhatsApp, SMS or email message fails, the order still goes through; the failure is just logged.

## Backups
- A copy of the database is saved every day to `data/backups/`, and the last 14 days are kept. `npm run backup` makes one immediately.
- **Also copy the backups off the server**, because a backup on the same disk won't survive a disk failure. For example, add a nightly cron job with [rclone](https://rclone.org) to Google Drive or S3:
  `0 3 * * * rclone copy /path/to/store/data/backups remote:store-backups`
- Back up `uploads/` (your product images) the same way.
- To restore, stop the store, copy a backup file over `data/store.db`, and start the store again.

## Locked out of the admin?
- Use **Forgot password?** on the admin login page. This needs order emails to be set up.
- Or, on the server, run `npm run admin -- you@example.com "new-strong-password"`. With Docker: `docker compose exec app node scripts/admin.js you@example.com "new-strong-password"`.

## Security built in
- Passwords are stored with scrypt.
- Login cookies can't be read by scripts, aren't sent from other sites, and are marked secure when the site uses HTTPS.
- Repeated attempts at login, sign-up, password reset, checkout and order tracking are slowed down (rate limited).
- Requests from other websites that would change data are blocked.
- Security headers are set on every response.
- Payment confirmations from Razorpay are checked before an order is marked paid.
- Payment keys and passwords are never shown again in the admin after saving, and never reach the storefront.
- Only JPG, PNG, WebP, GIF and AVIF images can be uploaded (5 MB maximum; no SVG, which can contain scripts).

---

## Features

**Storefront**
- Menu: **Home · Apparels · Merchandise · Bulk Order**. The Apparels and Merchandise menus are built from your categories (Admin → Categories):
  - A category with no parent becomes a menu heading.
  - Sub-categories can go two levels deep (T-Shirts → Round Neck / Collar).
  - A category can appear under more than one heading (Caps).
- Home page slides with a colour theme (Karnataka yellow and red, dark or light) and one or two photos each, e.g. "For him" and "For her". Edit them in Admin → Banners.
- Bulk Order page with a quote request form. Enquiries arrive by email and in Admin → Bulk enquiries, where you can set a status, add notes and export to CSV.
- Home page with banners, trending products, categories, collections, testimonials and a newsletter signup.
- Shop page with search, filters and sorting.
- Product pages with a size chart and reviews.
- Quick view, wishlist, cart drawer and coupons.
- Checkout with cash on delivery or Razorpay.
- Customer accounts, order tracking and a payment retry for unpaid orders.
- Password reset, a WhatsApp chat button, and policy pages.
- Works on mobile.

**Admin**
- Dashboard with sales charts, orders by status, top products and low-stock alerts.
- Integrations: GST invoices, Shiprocket shipping, WhatsApp and SMS alerts.
- Orders: update status and tracking details, export to CSV, and optionally email the customer.
- Products with photos, sizes and stock.
- Categories, collections, banners, coupons, reviews and testimonials.
- Customers and newsletter subscribers, with CSV export.
- Policy pages editor with a live preview.
- Settings: store details, logo, business details, shipping, payments, email, social links and admin password.

**SEO**
- Each page has its own title and description.
- Products include data that Google can show in search results (price, stock, star rating).
- WhatsApp and social media show a preview with the product image when a link is shared.
- `sitemap.xml` and `robots.txt` are generated automatically.

## Project layout
```
server.js              Express app, page routes, background jobs
lib/db.js              Database tables, settings
lib/auth.js            Passwords, sessions, password reset
lib/security.js        Rate limits, cross-site request checks, security headers
lib/shop.js            Cart pricing, coupons, orders, stock
lib/payments.js        Razorpay
lib/mailer.js          Emails
lib/render.js          Page titles, descriptions, link previews, sitemap
lib/pages.js           Policy pages (+ default-pages.js templates)
lib/backup.js          Daily database backups
lib/invoice.js         GST invoice maths, numbering and the printable invoice
lib/shiprocket.js      Shiprocket shipping and tracking
lib/notify.js          Sends order updates by email, WhatsApp and SMS (lib/whatsapp.js, lib/sms.js)
lib/seed.js            First-start setup and demo data
scripts/admin.js       Create or recover an admin account
routes/api.js          Storefront API
routes/admin.js        Admin API
public/                Storefront pages and assets
public/admin/          Admin dashboard
```
