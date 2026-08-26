const { Settings } = require('../models');
const { v4: uuidv4 } = require('uuid');

// ---- Site settings cache (admin-editable via /admin/settings) ----
async function getSetting(key, fallback = '') {
  const row = await Settings.findOne({ where: { key } });
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  const [row, created] = await Settings.findOrCreate({ where: { key }, defaults: { value } });
  if (!created) { row.value = value; await row.save(); }
  return row;
}

async function getAllSettings() {
  const rows = await Settings.findAll();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  // sensible defaults if not yet set by admin
  obj.siteName = obj.siteName || 'Apnar Turf';
  obj.tagline = obj.tagline || 'Book Your Turf, Play Your Game';
  obj.contactEmail = obj.contactEmail || 'info@apnarturf.com';
  obj.contactPhone = obj.contactPhone || '01700000000';
  obj.address = obj.address || 'Dhaka, Bangladesh';
  obj.primaryColor = obj.primaryColor || '#14a34a';
  obj.secondaryColor = obj.secondaryColor || '#0d6e2f';
  return obj;
}

// Converts a "#rrggbb" (or "#rgb") color into "r,g,b" so it can be dropped into Bootstrap's
// rgba()-based CSS variables (e.g. --bs-success-rgb). Falls back to the default green if the
// admin hasn't picked a color yet or typed something invalid.
function hexToRgb(hex) {
  const fallback = '20,163,74';
  if (!hex) return fallback;
  const clean = String(hex).trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  const num = parseInt(full, 16);
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}

// ---- Pricing logic: weekend + peak-hour pricing ----
function isWeekend(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday (BD weekend: Fri/Sat)
  return day === 5 || day === 6;
}

function isPeakHour(startTime, peakStart, peakEnd) {
  return startTime >= peakStart && startTime < peakEnd;
}

function calcSlotPrice(turf, dateStr, startTime) {
  let price = turf.pricePerHour;
  if (isWeekend(dateStr) && turf.weekendPrice) {
    price = turf.weekendPrice;
  } else if (isPeakHour(startTime, turf.peakHourStart, turf.peakHourEnd) && turf.peakHourPrice) {
    price = turf.peakHourPrice;
  }
  return price;
}

function generateBookingRef() {
  return 'TB-' + uuidv4().split('-')[0].toUpperCase();
}

function generateRegRef() {
  return 'TR-' + uuidv4().split('-')[0].toUpperCase();
}

function generateInvoiceNo() {
  return 'INV-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 900 + 100);
}

function generateTxnId(method) {
  const prefix = { bKash: 'BKS', Nagad: 'NGD', Rocket: 'RKT', Card: 'CRD', Cash: 'CSH' }[method] || 'TXN';
  return prefix + Date.now();
}

// ---- Slot generation for a turf on a given date ----
function generateSlots(turf) {
  const slots = [];
  let [openH] = turf.openingTime.split(':').map(Number);
  let closeH = turf.closingTime === '24:00' ? 24 : Number(turf.closingTime.split(':')[0]);
  for (let h = openH; h < closeH; h++) {
    const start = String(h).padStart(2, '0') + ':00';
    const end = String(h + 1).padStart(2, '0') + ':00';
    slots.push({ startTime: start, endTime: end });
  }
  return slots;
}

// ---- Tournament registration gate ----
// Single source of truth for "can a team still register?". Both the details page and the
// POST handler call this, so the UI can never offer a form that the server would reject.
// `activeTeamCount` = teams that are pending or confirmed (withdrawn/rejected free their spot).
function tournamentRegistrationState(tournament, activeTeamCount) {
  const spotsLeft = Math.max(tournament.maxTeams - activeTeamCount, 0);
  const today = new Date().toISOString().slice(0, 10);

  let reason = null;
  if (tournament.status === 'cancelled') reason = 'This tournament has been cancelled.';
  else if (tournament.status === 'completed') reason = 'This tournament is already over.';
  else if (tournament.status === 'ongoing') reason = 'This tournament has already started.';
  else if (!tournament.registrationOpen) reason = 'Registration has been closed by the organiser.';
  else if (tournament.registrationDeadline && tournament.registrationDeadline < today) reason = 'The registration deadline has passed.';
  else if (tournament.startDate && tournament.startDate < today) reason = 'This tournament has already started.';
  else if (spotsLeft <= 0) reason = 'All team spots are filled.';

  return { open: reason === null, reason, spotsLeft, activeTeamCount };
}

module.exports = {
  getSetting, setSetting, getAllSettings, hexToRgb,
  calcSlotPrice, isWeekend, isPeakHour,
  generateBookingRef, generateRegRef, generateInvoiceNo, generateTxnId, generateSlots,
  tournamentRegistrationState
};
