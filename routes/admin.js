const express = require('express');
const router = express.Router();
const { Op, fn, col, literal } = require('sequelize');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const {
  sequelize, User, Turf, Booking, Payment, Review, Coupon, Tournament, Team, SlotBlock, Notification
} = require('../models');
const { generateSlots, calcSlotPrice } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const { getAllSettings, setSetting } = require('../utils/helpers');

router.use(requireAdmin);

// Vercel's serverless filesystem is read-only (except /tmp, which is ephemeral and not
// shared between function instances), so writing uploaded files to public/uploads with
// diskStorage fails with EROFS. Instead, keep the file in memory and store it directly in
// the database as a base64 data URI - no filesystem write needed.
// Cap at 2MB - Vercel serverless functions reject request bodies over ~4.5MB, and the
// base64 encoding below adds about 33% on top of the original file size.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function fileToDataUri(file) {
  return file ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}` : null;
}

// -------- Dashboard --------
router.get('/dashboard', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totalBookings = await Booking.count();
  const todayBookings = await Booking.count({ where: { date: today } });
  const upcomingBookings = await Booking.count({ where: { date: { [Op.gte]: today }, status: ['pending', 'confirmed'] } });
  const totalUsers = await User.count({ where: { role: 'user' } });
  const totalTurfs = await Turf.count();

  const revenueRow = await Payment.findOne({
    attributes: [[fn('SUM', col('amount')), 'total']],
    where: { status: 'paid' },
    raw: true
  });
  const totalRevenue = revenueRow.total || 0;

  const recentBookings = await Booking.findAll({
    include: [Turf, User, Payment],
    order: [['createdAt', 'DESC']],
    limit: 10
  });

  res.render('admin/dashboard', {
    title: 'Admin Dashboard', layout: 'admin/layout',
    totalBookings, todayBookings, upcomingBookings, totalUsers, totalTurfs, totalRevenue, recentBookings
  });
});

// -------- Turf management --------
router.get('/turfs', async (req, res) => {
  const turfs = await Turf.findAll({ order: [['createdAt', 'DESC']] });
  res.render('admin/turfs', { title: 'Manage Turfs', layout: 'admin/layout', turfs });
});

router.get('/turfs/new', (req, res) => {
  res.render('admin/turf-form', { title: 'Add Turf', layout: 'admin/layout', turf: null });
});

router.post('/turfs', upload.single('image'), async (req, res) => {
  const b = req.body;
  await Turf.create({
    name: b.name, type: b.type, indoorOutdoor: b.indoorOutdoor, capacity: b.capacity,
    location: b.location, mapEmbedUrl: b.mapEmbedUrl,
    pricePerHour: b.pricePerHour, weekendPrice: b.weekendPrice || null, peakHourPrice: b.peakHourPrice || null,
    peakHourStart: b.peakHourStart || '18:00', peakHourEnd: b.peakHourEnd || '22:00',
    openingTime: b.openingTime || '06:00', closingTime: b.closingTime || '24:00',
    description: b.description,
    image: fileToDataUri(req.file) || '/img/turf-placeholder.jpg',
    facilities: JSON.stringify((b.facilities || '').split(',').map(f => f.trim()).filter(Boolean))
  });
  req.flash('success', 'Turf added.');
  res.redirect('/admin/turfs');
});

router.get('/turfs/:id/edit', async (req, res) => {
  const turf = await Turf.findByPk(req.params.id);
  res.render('admin/turf-form', { title: 'Edit Turf', layout: 'admin/layout', turf });
});

router.post('/turfs/:id', upload.single('image'), async (req, res) => {
  const turf = await Turf.findByPk(req.params.id);
  if (!turf) { req.flash('error', 'Turf not found'); return res.redirect('/admin/turfs'); }
  const b = req.body;
  Object.assign(turf, {
    name: b.name, type: b.type, indoorOutdoor: b.indoorOutdoor, capacity: b.capacity,
    location: b.location, mapEmbedUrl: b.mapEmbedUrl,
    pricePerHour: b.pricePerHour, weekendPrice: b.weekendPrice || null, peakHourPrice: b.peakHourPrice || null,
    peakHourStart: b.peakHourStart || '18:00', peakHourEnd: b.peakHourEnd || '22:00',
    openingTime: b.openingTime || '06:00', closingTime: b.closingTime || '24:00',
    description: b.description,
    isActive: b.isActive === 'on',
    facilities: JSON.stringify((b.facilities || '').split(',').map(f => f.trim()).filter(Boolean))
  });
  if (req.file) turf.image = fileToDataUri(req.file);
  await turf.save();
  req.flash('success', 'Turf updated.');
  res.redirect('/admin/turfs');
});

router.post('/turfs/:id/delete', async (req, res) => {
  await Turf.destroy({ where: { id: req.params.id } });
  req.flash('success', 'Turf deleted.');
  res.redirect('/admin/turfs');
});

// -------- Booking management --------
router.get('/bookings', async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  const bookings = await Booking.findAll({ where, include: [Turf, User, Payment], order: [['createdAt', 'DESC']] });
  res.render('admin/bookings', { title: 'Manage Bookings', layout: 'admin/layout', bookings, statusFilter: req.query.status || '' });
});

router.post('/bookings/:id/status', async (req, res) => {
  const booking = await Booking.findByPk(req.params.id);
  if (booking) { booking.status = req.body.status; await booking.save(); }
  req.flash('success', 'Booking status updated.');
  res.redirect('/admin/bookings');
});

// -------- Slot Availability Management --------
router.get('/slots', async (req, res) => {
  const turfs = await Turf.findAll({ order: [['name', 'ASC']] });
  const turfId = req.query.turfId || (turfs[0] ? turfs[0].id : null);
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  let slotRows = [];
  if (turfId) {
    const turf = await Turf.findByPk(turfId);
    if (turf) {
      const slotDefs = generateSlots(turf);
      const bookings = await Booking.findAll({
        where: { TurfId: turfId, date, status: ['pending', 'confirmed'] },
        include: [User]
      });
      const blocks = await SlotBlock.findAll({ where: { TurfId: turfId, date } });

      slotRows = slotDefs.map(s => {
        const booking = bookings.find(b => b.startTime === s.startTime);
        const block = blocks.find(b => b.startTime === s.startTime);
        let status = 'available';
        if (block) status = 'blocked';
        else if (booking) status = booking.status === 'confirmed' ? 'booked' : 'pending';
        return {
          ...s,
          status,
          price: calcSlotPrice(turf, date, s.startTime),
          booking: booking || null,
          block: block || null
        };
      });
    }
  }

  res.render('admin/slots', {
    title: 'Slot Availability', layout: 'admin/layout',
    turfs, selectedTurfId: turfId ? Number(turfId) : null, selectedDate: date, slotRows
  });
});

router.post('/slots/block', async (req, res) => {
  const { turfId, date, startTime, endTime, reason } = req.body;
  try {
    await SlotBlock.create({ TurfId: turfId, date, startTime, endTime, reason: reason || 'Blocked by admin' });
    req.flash('success', `Slot ${startTime} blocked.`);
  } catch (err) {
    req.flash('error', 'Could not block this slot (it may already be blocked).');
  }
  res.redirect(`/admin/slots?turfId=${turfId}&date=${date}`);
});

router.post('/slots/unblock', async (req, res) => {
  const { turfId, date, startTime } = req.body;
  await SlotBlock.destroy({ where: { TurfId: turfId, date, startTime } });
  req.flash('success', `Slot ${startTime} unblocked.`);
  res.redirect(`/admin/slots?turfId=${turfId}&date=${date}`);
});

router.post('/slots/cancel-booking', async (req, res) => {
  const { bookingId, turfId, date } = req.body;
  const booking = await Booking.findByPk(bookingId);
  if (booking) { booking.status = 'cancelled'; await booking.save(); }
  req.flash('success', 'Booking cancelled and slot freed.');
  res.redirect(`/admin/slots?turfId=${turfId}&date=${date}`);
});

// -------- User management --------
router.get('/users', async (req, res) => {
  const users = await User.findAll({ where: { role: 'user' }, order: [['createdAt', 'DESC']] });
  res.render('admin/users', { title: 'Manage Users', layout: 'admin/layout', users });
});

router.post('/users/:id/toggle-member', async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (user) {
    user.isMember = !user.isMember;
    user.memberSince = user.isMember ? new Date() : null;
    await user.save();
  }
  req.flash('success', 'Membership updated.');
  res.redirect('/admin/users');
});

// -------- Payment management --------
router.get('/payments', async (req, res) => {
  const where = {};
  if (req.query.purpose) where.purpose = req.query.purpose;
  const payments = await Payment.findAll({
    where,
    include: [
      { model: Booking, include: [Turf, User] },
      { model: Team, include: [Tournament, User] }
    ],
    order: [['createdAt', 'DESC']]
  });
  res.render('admin/payments', {
    title: 'Manage Payments', layout: 'admin/layout',
    payments, purposeFilter: req.query.purpose || ''
  });
});

router.post('/payments/:id/status', async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);
  if (payment) {
    payment.status = req.body.status;
    await payment.save();

    if (payment.BookingId && req.body.status === 'paid') {
      const booking = await Booking.findByPk(payment.BookingId);
      if (booking) { booking.status = 'confirmed'; await booking.save(); }
    }
    if (payment.TeamId) {
      const team = await Team.findByPk(payment.TeamId);
      if (team && team.status !== 'withdrawn') {
        if (req.body.status === 'paid') team.status = 'confirmed';
        else if (req.body.status === 'failed') team.status = 'rejected';
        else if (req.body.status === 'pending') team.status = 'pending';
        await team.save();
      }
    }
  }
  req.flash('success', 'Payment status updated.');
  res.redirect('/admin/payments' + (req.body.purpose ? `?purpose=${req.body.purpose}` : ''));
});

// -------- Reviews moderation --------
router.get('/reviews', async (req, res) => {
  const reviews = await Review.findAll({ include: [User, Turf], order: [['createdAt', 'DESC']] });
  res.render('admin/reviews', { title: 'Manage Reviews', layout: 'admin/layout', reviews });
});

router.post('/reviews/:id/toggle', async (req, res) => {
  const review = await Review.findByPk(req.params.id);
  if (review) { review.isApproved = !review.isApproved; await review.save(); }
  res.redirect('/admin/reviews');
});

router.post('/reviews/:id/delete', async (req, res) => {
  await Review.destroy({ where: { id: req.params.id } });
  res.redirect('/admin/reviews');
});

// -------- Coupons / Offers --------
router.get('/coupons', async (req, res) => {
  const coupons = await Coupon.findAll({ order: [['createdAt', 'DESC']] });
  res.render('admin/coupons', { title: 'Coupons & Offers', layout: 'admin/layout', coupons });
});

router.post('/coupons', async (req, res) => {
  const b = req.body;
  await Coupon.create({
    code: b.code.toUpperCase(), discountType: b.discountType, discountValue: b.discountValue,
    maxUses: b.maxUses || 100, expiresAt: b.expiresAt || null
  });
  req.flash('success', 'Coupon created.');
  res.redirect('/admin/coupons');
});

router.post('/coupons/:id/toggle', async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (coupon) { coupon.isActive = !coupon.isActive; await coupon.save(); }
  res.redirect('/admin/coupons');
});

// -------- Tournaments & Teams --------
router.get('/tournaments', async (req, res) => {
  const tournaments = await Tournament.findAll({ include: [Team], order: [['startDate', 'ASC']] });

  const feeRow = await Payment.findOne({
    attributes: [[fn('SUM', col('amount')), 'total']],
    where: { purpose: 'tournament', status: 'paid' },
    raw: true
  });

  res.render('admin/tournaments', {
    title: 'Tournaments', layout: 'admin/layout',
    tournaments,
    editing: null,
    entryFeeRevenue: feeRow.total || 0
  });
});

router.get('/tournaments/:id/edit', async (req, res) => {
  const tournaments = await Tournament.findAll({ include: [Team], order: [['startDate', 'ASC']] });
  const editing = await Tournament.findByPk(req.params.id);
  if (!editing) { req.flash('error', 'Tournament not found.'); return res.redirect('/admin/tournaments'); }
  const feeRow = await Payment.findOne({
    attributes: [[fn('SUM', col('amount')), 'total']],
    where: { purpose: 'tournament', status: 'paid' },
    raw: true
  });
  res.render('admin/tournaments', {
    title: 'Edit Tournament', layout: 'admin/layout',
    tournaments, editing, entryFeeRevenue: feeRow.total || 0
  });
});

function tournamentFieldsFrom(body) {
  return {
    name: body.name,
    sport: body.sport,
    startDate: body.startDate,
    endDate: body.endDate,
    registrationDeadline: body.registrationDeadline || null,
    entryFee: body.entryFee || 0,
    prizeMoney: body.prizeMoney || 0,
    maxTeams: body.maxTeams || 16,
    teamSize: body.teamSize || 7,
    venue: body.venue || null,
    rules: body.rules || null,
    description: body.description,
    registrationOpen: body.registrationOpen === 'on'
  };
}

router.post('/tournaments', upload.single('image'), async (req, res) => {
  await Tournament.create({
    ...tournamentFieldsFrom(req.body),
    registrationOpen: req.body.registrationOpen !== undefined ? req.body.registrationOpen === 'on' : true,
    status: req.body.status || 'upcoming',
    image: fileToDataUri(req.file) || '/img/tournament-placeholder.jpg'
  });
  req.flash('success', 'Tournament created.');
  res.redirect('/admin/tournaments');
});

router.post('/tournaments/:id', upload.single('image'), async (req, res) => {
  const tournament = await Tournament.findByPk(req.params.id);
  if (!tournament) { req.flash('error', 'Tournament not found.'); return res.redirect('/admin/tournaments'); }
  Object.assign(tournament, tournamentFieldsFrom(req.body));
  if (req.body.status) tournament.status = req.body.status;
  if (req.file) tournament.image = fileToDataUri(req.file);
  await tournament.save();
  req.flash('success', 'Tournament updated.');
  res.redirect('/admin/tournaments');
});

router.post('/tournaments/:id/status', async (req, res) => {
  const tournament = await Tournament.findByPk(req.params.id);
  if (tournament) { tournament.status = req.body.status; await tournament.save(); }
  req.flash('success', 'Tournament status updated.');
  res.redirect('/admin/tournaments');
});

router.post('/tournaments/:id/toggle-registration', async (req, res) => {
  const tournament = await Tournament.findByPk(req.params.id);
  if (tournament) {
    tournament.registrationOpen = !tournament.registrationOpen;
    await tournament.save();
    req.flash('success', `Registration ${tournament.registrationOpen ? 'opened' : 'closed'} for ${tournament.name}.`);
  }
  res.redirect('/admin/tournaments');
});

router.post('/tournaments/:id/delete', async (req, res) => {
  const teamCount = await Team.count({ where: { TournamentId: req.params.id, status: ['pending', 'confirmed'] } });
  if (teamCount > 0) {
    req.flash('error', `Cannot delete: ${teamCount} team(s) are still registered. Cancel the tournament instead.`);
    return res.redirect('/admin/tournaments');
  }
  await Tournament.destroy({ where: { id: req.params.id } });
  req.flash('success', 'Tournament deleted.');
  res.redirect('/admin/tournaments');
});

// -------- Registered teams for one tournament --------
router.get('/tournaments/:id/teams', async (req, res) => {
  const tournament = await Tournament.findByPk(req.params.id);
  if (!tournament) { req.flash('error', 'Tournament not found.'); return res.redirect('/admin/tournaments'); }
  const teams = await Team.findAll({
    where: { TournamentId: tournament.id },
    include: [User, Payment],
    order: [['createdAt', 'ASC']]
  });
  res.render('admin/tournament-teams', {
    title: 'Teams - ' + tournament.name, layout: 'admin/layout',
    tournament,
    teams: teams.map(t => ({ team: t, players: JSON.parse(t.players || '[]') })),
    collected: teams.reduce((sum, t) => sum + (t.Payment && t.Payment.status === 'paid' ? t.Payment.amount : 0), 0),
    pendingAmount: teams.reduce((sum, t) => sum + (t.Payment && t.Payment.status === 'pending' ? t.Payment.amount : 0), 0)
  });
});

router.post('/teams/:id/status', async (req, res) => {
  const team = await Team.findByPk(req.params.id, { include: [Payment, Tournament] });
  if (!team) { req.flash('error', 'Team not found.'); return res.redirect('/admin/tournaments'); }

  const status = req.body.status;
  if (!['pending', 'confirmed', 'rejected', 'withdrawn'].includes(status)) {
    req.flash('error', 'Invalid status.');
    return res.redirect(`/admin/tournaments/${team.TournamentId}/teams`);
  }

  if (status === 'confirmed' && team.status !== 'confirmed') {
    const active = await Team.count({ where: { TournamentId: team.TournamentId, status: ['pending', 'confirmed'] } });
    const alreadyCounted = ['pending', 'confirmed'].includes(team.status);
    if (!alreadyCounted && active >= team.Tournament.maxTeams) {
      req.flash('error', 'Tournament is full — cannot confirm another team.');
      return res.redirect(`/admin/tournaments/${team.TournamentId}/teams`);
    }
  }

  team.status = status;
  await team.save();

  if (team.Payment) {
    if (status === 'confirmed') team.Payment.status = 'paid';
    else if (status === 'rejected') team.Payment.status = 'failed';
    else if (status === 'pending') team.Payment.status = 'pending';
    await team.Payment.save();
  }

  Notification.create({
    title: `Tournament Registration ${status}`,
    message: `Your team "${team.name}" for ${team.Tournament ? team.Tournament.name : 'the tournament'} is now ${status}.`,
    type: status === 'confirmed' ? 'success' : status === 'rejected' ? 'warning' : 'info',
    UserId: team.UserId
  }).catch(() => {});

  req.flash('success', `Team "${team.name}" marked ${status}.`);
  res.redirect(`/admin/tournaments/${team.TournamentId}/teams`);
});

router.post('/teams/:id/delete', async (req, res) => {
  const team = await Team.findByPk(req.params.id);
  if (!team) { req.flash('error', 'Team not found.'); return res.redirect('/admin/tournaments'); }
  const tournamentId = team.TournamentId;
  await Payment.destroy({ where: { TeamId: team.id } });
  await team.destroy();
  req.flash('success', 'Registration deleted.');
  res.redirect(`/admin/tournaments/${tournamentId}/teams`);
});

// -------- Reports --------
router.get('/reports', async (req, res) => {
  const bookingsByTurf = await Booking.findAll({
    attributes: ['TurfId', [fn('COUNT', col('Booking.id')), 'count'], [fn('SUM', col('totalPrice')), 'revenue']],
    include: [{ model: Turf, attributes: ['name'] }],
    group: ['TurfId', 'Turf.id', 'Turf.name'],
    raw: true
  });
  const monthlyRevenue = await Payment.findAll({
    attributes: [[fn('strftime', '%Y-%m', col('createdAt')), 'month'], [fn('SUM', col('amount')), 'total']],
    where: { status: 'paid' },
    group: ['month'],
    raw: true
  }).catch(() => []); // strftime is sqlite-only; MySQL deployments can swap for DATE_FORMAT
  res.render('admin/reports', { title: 'Reports', layout: 'admin/layout', bookingsByTurf, monthlyRevenue });
});

// -------- Site Settings (editable site name/logo/contact info) --------
router.get('/settings', async (req, res) => {
  const settings = await getAllSettings();
  res.render('admin/settings', { title: 'Site Settings', layout: 'admin/layout', settings });
});

router.post('/settings', upload.single('logo'), async (req, res) => {
  const b = req.body;
 for (const key of ['siteName', 'tagline', 'contactEmail', 'contactPhone', 'address', 'facebookUrl', 'primaryColor', 'secondaryColor']) {
    if (b[key] !== undefined) await setSetting(key, b[key]);
  }
  if (req.file) await setSetting('logo', fileToDataUri(req.file));
  req.flash('success', 'Settings updated.');
  res.redirect('/admin/settings');
});

module.exports = router;
