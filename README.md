# Turf Booking System (Node.js + Express + MySQL)

A complete Turf Management & Online Booking System — public site + full admin panel.
Built with Node.js, Express, EJS, and Sequelize (MySQL for production, SQLite works out of the box for local testing — no MySQL install needed to try it).

## Features

**User side:** home page, turf listing & details (facilities, map embed, reviews/ratings), smart date/time slot booking (available / booked / pending), coupon codes, simulated bKash/Nagad/Rocket/Card/Cash payment, booking confirmation with QR code + invoice, My Bookings (history, cancel), tournament listing & team registration, contact page, register/login.

**Admin panel** (`/admin`): dashboard (today's/upcoming bookings, revenue), turf CRUD with image upload, weekend & peak-hour pricing, booking management, **Slot Availability page** (see every slot for a turf/date and manually block or free any slot — maintenance, private event, etc. — independent of real bookings), user management (membership toggle), **payment verification** (see the transaction ID, payer name and payer number the customer submitted, and approve/reject), review moderation, coupon/offer management, tournament creation, revenue reports, and **site settings** — change the site name, logo, tagline and contact info from the admin panel; it updates everywhere on the site instantly.

## Manual payment verification flow (bKash / Nagad / Rocket)

Since there's no live payment gateway plugged in, payment is verified manually, like most small turf sites do in practice:

1. On the turf page, the user picks a slot and payment method. For bKash/Nagad/Rocket, the **Confirm Booking** button stays disabled until they fill in the Transaction ID, payer name and payer number of the payment they just sent to the admin's number (shown on the form).
2. The booking is created with status **pending** and shows up on `/admin/payments` with the transaction ID/payer info visible.
3. Admin checks their bKash/Nagad/Rocket account for that transaction and, if it matches, sets the payment status to **paid** on `/admin/payments` — this automatically flips the booking to **confirmed**.
4. The user can track this at any time on `/my-bookings` and the booking detail page, which shows a Booked → Payment Verified → Completed progress tracker. If they forgot to submit trx details (e.g. paid after creating the booking), there's a "Submit Payment Details" form right on the booking page.

## Slot colors & availability

Slots are color-coded everywhere (turf page + admin Slot Availability page): green = available, red = booked (confirmed), yellow = pending payment verification, gray = blocked by admin. Clicking a taken slot shows an "already booked" message instead of silently doing nothing. Since a turf isn't always bookable every hour of every day, the admin's **Slot Availability** page lets you block or unblock any specific date/time slot per turf whenever you need to (closed for a private event, under maintenance, etc.) — it overrides the calendar immediately.

## Important fix in this version

Earlier, booking a **second** slot for the same turf could fail with a database error ("TurfId must be unique"). This was a bug in how the database enforced "no double booking the same slot" — it was accidentally enforcing "each turf can only ever have ONE booking, period." This is now fixed at the source (`utils/dbFix.js`, wired into both `npm start` and `npm run seed`), and it also auto-repairs an existing database that already has the bad constraint — you don't need to do anything, just run the app as usual.

## Quick Start (local demo, SQLite — no database setup needed)

```bash
npm install
npm run seed     # creates admin/demo accounts, sample turfs, a coupon and a tournament
npm start
```

Visit http://localhost:3000

- Admin login: `admin@turf.com` / `admin123`
- Demo user login: `user@turf.com` / `user123`
- Sample coupon: `WELCOME10` (10% off)

## Switching to MySQL for production

1. Create a MySQL database, e.g. `turf_booking`.
2. Edit `.env`:
   ```
   DB_DIALECT=mysql
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=turf_booking
   DB_USER=root
   DB_PASS=yourpassword
   ```
3. Run `npm run seed` then `npm start`. Sequelize will create all tables automatically (`sequelize.sync`).

## Setting your site name (as admin)

Log in as admin → **Site Settings** in the sidebar → set Site Name, logo, tagline, and contact info → Save. No code changes needed; this updates the navbar, footer, page titles, and contact page everywhere.

## Project structure

```
config/database.js      Sequelize connection (mysql or sqlite via DB_DIALECT)
models/index.js          All Sequelize models + associations
routes/                  auth.js, public.js, booking.js, tournament.js, admin.js
middleware/auth.js       requireLogin / requireAdmin guards
utils/helpers.js         pricing logic (weekend/peak), settings, booking ref/invoice generators
utils/mailer.js          email (nodemailer) + SMS stub
views/                   EJS templates (user/, admin/, tournament/, partials/)
public/                  css, js, uploaded images
seed/seed.js             sample data
```

## Notes on features that need real credentials to go live

- **Payments** (bKash/Nagad/Rocket/Card): currently simulated (mock transaction IDs, instant "paid" status) so you can test the full flow end-to-end. To go live, replace the payment block in `routes/booking.js` with real gateway API calls (bKash Merchant API, SSLCommerz, etc.) — the booking/payment data model already supports it.
- **Email**: set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` in `.env` to send real booking confirmation emails (currently just logs to console if unset).
- **SMS**: `utils/mailer.js` has a stub (`sendSMS`) — set `SMS_ENABLED=true` and plug in a provider (Twilio, SSL Wireless, etc.) to send real SMS confirmations.
- **Double-booking prevention**: handled via a database transaction with row locking plus a unique index on (Turf, date, startTime) — two users cannot successfully book the same slot.

## Extending further

The data model already includes Tournaments, Teams, Coupons, Reviews, Notifications, and Memberships, so features like leaderboards, player stats, or push notifications can be layered on without a schema redesign.
