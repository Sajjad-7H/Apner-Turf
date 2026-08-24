const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { sequelize, Tournament, Team, Payment, Notification } = require('../models');
const { requireLogin } = require('../middleware/auth');
const {
  generateRegRef, generateInvoiceNo, generateTxnId, tournamentRegistrationState
} = require('../utils/helpers');
const { sendMail, sendSMS } = require('../utils/mailer');

// A team only occupies a spot while it is pending or confirmed.
const ACTIVE_STATUSES = ['pending', 'confirmed'];
const ONLINE_METHODS = ['bKash', 'Nagad', 'Rocket'];
const VALID_METHODS = ['bKash', 'Nagad', 'Rocket', 'Card', 'Cash'];

// ---------------- Public listing ----------------
router.get('/tournaments', async (req, res) => {
  const where = {};
  const sport = req.query.sport && req.query.sport !== 'All' ? req.query.sport : null;
  const status = req.query.status && req.query.status !== 'All' ? req.query.status : null;
  if (sport) where.sport = sport;
  if (status) where.status = status;

  const tournaments = await Tournament.findAll({
    where,
    include: [{ model: Team, attributes: ['id', 'status'] }],
    order: [['startDate', 'ASC']]
  });

  // Decorate each tournament with its live registration state for the cards
  const rows = tournaments.map(t => {
    const activeTeams = t.Teams.filter(x => ACTIVE_STATUSES.includes(x.status)).length;
    return { t, reg: tournamentRegistrationState(t, activeTeams) };
  });

  res.render('tournament/list', {
    title: 'Tournaments',
    rows,
    selectedSport: req.query.sport || 'All',
    selectedStatus: req.query.status || 'All'
  });
});

// ---------------- My registrations ----------------
// NOTE: declared before '/tournaments/:id' is irrelevant (different prefix), but it must come
// before any '/my-tournaments/:id' route below so the literal path wins.
router.get('/my-tournaments', requireLogin, async (req, res) => {
  const teams = await Team.findAll({
    where: { UserId: req.session.user.id },
    include: [Tournament, Payment],
    order: [['createdAt', 'DESC']]
  });
  res.render('tournament/my-tournaments', { title: 'My Tournaments', teams });
});

// Registration detail / entry-fee invoice
router.get('/my-tournaments/:id', requireLogin, async (req, res) => {
  const team = await Team.findOne({
    where: { id: req.params.id, UserId: req.session.user.id },
    include: [Tournament, Payment]
  });
  if (!team) { req.flash('error', 'Registration not found.'); return res.redirect('/my-tournaments'); }
  res.render('tournament/registration-detail', {
    title: 'Registration ' + team.regRef,
    team,
    players: JSON.parse(team.players || '[]')
  });
});

// Re-submit / correct entry-fee payment details
router.post('/my-tournaments/:id/payment', requireLogin, async (req, res) => {
  const { transactionId, payerName, payerNumber, method } = req.body;
  const team = await Team.findOne({
    where: { id: req.params.id, UserId: req.session.user.id },
    include: [Payment]
  });
  if (!team) { req.flash('error', 'Registration not found.'); return res.redirect('/my-tournaments'); }
  if (team.status === 'withdrawn') {
    req.flash('error', 'This registration was withdrawn.');
    return res.redirect(`/my-tournaments/${team.id}`);
  }
  if (team.status === 'confirmed') {
    req.flash('error', 'Your entry fee is already verified — nothing to update.');
    return res.redirect(`/my-tournaments/${team.id}`);
  }
  if (!team.Payment) {
    req.flash('error', 'No entry fee is due for this registration.');
    return res.redirect(`/my-tournaments/${team.id}`);
  }
  if (!transactionId || !transactionId.trim() || !payerName || !payerNumber) {
    req.flash('error', 'Transaction ID, payer name and payer number are all required.');
    return res.redirect(`/my-tournaments/${team.id}`);
  }

  if (method && VALID_METHODS.includes(method)) team.Payment.method = method;
  team.Payment.transactionId = transactionId.trim();
  team.Payment.payerName = payerName;
  team.Payment.payerNumber = payerNumber;
  team.Payment.status = 'pending';
  await team.Payment.save();

  // A rejected registration goes back into the queue once new proof is submitted
  if (team.status === 'rejected') { team.status = 'pending'; await team.save(); }

  req.flash('success', 'Payment details submitted. The organiser will verify and confirm your team.');
  res.redirect(`/my-tournaments/${team.id}`);
});

// Withdraw a team (frees its spot for someone else)
router.post('/my-tournaments/:id/withdraw', requireLogin, async (req, res) => {
  const team = await Team.findOne({
    where: { id: req.params.id, UserId: req.session.user.id },
    include: [Payment]
  });
  if (!team) { req.flash('error', 'Registration not found.'); return res.redirect('/my-tournaments'); }
  if (team.status === 'withdrawn') {
    req.flash('error', 'This team is already withdrawn.');
    return res.redirect('/my-tournaments');
  }
  team.status = 'withdrawn';
  await team.save();
  if (team.Payment && team.Payment.status === 'pending') {
    team.Payment.status = 'failed';
    await team.Payment.save();
  }
  req.flash('success', 'Team withdrawn. If you already paid the entry fee, contact the organiser for a refund.');
  res.redirect('/my-tournaments');
});

// ---------------- Tournament details ----------------
router.get('/tournaments/:id', async (req, res) => {
  const tournament = await Tournament.findByPk(req.params.id, {
    include: [{ model: Team, where: { status: ACTIVE_STATUSES }, required: false }]
  });
  if (!tournament) { req.flash('error', 'Tournament not found.'); return res.redirect('/tournaments'); }

  const reg = tournamentRegistrationState(tournament, tournament.Teams.length);

  // Has this user already got a team in here?
  let myTeam = null;
  if (req.session.user) {
    myTeam = await Team.findOne({
      where: { TournamentId: tournament.id, UserId: req.session.user.id, status: ACTIVE_STATUSES },
      include: [Payment]
    });
  }

  res.render('tournament/details', {
    title: tournament.name,
    tournament,
    reg,
    myTeam,
    rules: (tournament.rules || '').split('\n').map(r => r.trim()).filter(Boolean)
  });
});

// ---------------- Register a team (with entry-fee payment) ----------------
router.post('/tournaments/:id/register', requireLogin, async (req, res) => {
  const tournamentId = req.params.id;
  const {
    teamName, captainName, captainPhone, captainEmail, players, notes,
    paymentMethod, transactionId, payerName, payerNumber
  } = req.body;
  const back = `/tournaments/${tournamentId}`;

  const t = await sequelize.transaction();
  try {
    const tournament = await Tournament.findByPk(tournamentId, { transaction: t });
    if (!tournament) throw new Error('Tournament not found.');

    // Re-count inside the transaction so two captains can't grab the last spot at once
    const activeTeams = await Team.count({
      where: { TournamentId: tournament.id, status: ACTIVE_STATUSES },
      transaction: t
    });
    const reg = tournamentRegistrationState(tournament, activeTeams);
    if (!reg.open) throw new Error(reg.reason);

    // One active registration per user per tournament
    const mine = await Team.findOne({
      where: { TournamentId: tournament.id, UserId: req.session.user.id, status: ACTIVE_STATUSES },
      transaction: t
    });
    if (mine) throw new Error('You have already registered a team for this tournament.');

    if (!teamName || !teamName.trim()) throw new Error('Team name is required.');
    if (!captainName || !captainName.trim()) throw new Error('Captain name is required.');
    if (!captainPhone || !captainPhone.trim()) throw new Error('Captain phone is required.');

    // Team names must be unique within a tournament so the fixture list stays readable.
    // Compared in JS rather than with LIKE so that %/_ in a team name aren't treated as wildcards.
    const existingNames = await Team.findAll({
      where: { TournamentId: tournament.id, status: ACTIVE_STATUSES },
      attributes: ['name'],
      transaction: t
    });
    if (existingNames.some(x => x.name.trim().toLowerCase() === teamName.trim().toLowerCase())) {
      throw new Error(`A team named "${teamName.trim()}" is already registered. Please pick another name.`);
    }

    const playerList = (players || '').split(',').map(p => p.trim()).filter(Boolean);
    if (tournament.teamSize && playerList.length < tournament.teamSize) {
      throw new Error(`This is a ${tournament.teamSize}-a-side tournament — please list at least ${tournament.teamSize} players (comma separated). You listed ${playerList.length}.`);
    }

    const fee = Number(tournament.entryFee) || 0;

    // Paid tournaments need a payment method, and the mobile-wallet methods need proof
    if (fee > 0) {
      if (!paymentMethod || !VALID_METHODS.includes(paymentMethod)) {
        throw new Error('Please choose a valid payment method for the entry fee.');
      }
      if (ONLINE_METHODS.includes(paymentMethod)) {
        if (!transactionId || !transactionId.trim() || !payerName || !payerName.trim() || !payerNumber || !payerNumber.trim()) {
          throw new Error('Please enter the Transaction ID, payer name and payer number for your entry fee payment.');
        }
      }
    }

    const team = await Team.create({
      name: teamName.trim(),
      captainName: captainName.trim(),
      captainPhone: captainPhone.trim(),
      captainEmail: (captainEmail || req.session.user.email || '').trim() || null,
      players: JSON.stringify(playerList),
      regRef: generateRegRef(),
      entryFeeAmount: fee,
      // Free tournaments are confirmed on the spot; paid ones wait for the organiser to verify
      status: fee > 0 ? 'pending' : 'confirmed',
      notes: notes || null,
      TournamentId: tournament.id,
      UserId: req.session.user.id
    }, { transaction: t });

    let payment = null;
    if (fee > 0) {
      payment = await Payment.create({
        method: paymentMethod,
        amount: fee,
        status: 'pending',
        purpose: 'tournament',
        transactionId: transactionId && transactionId.trim() ? transactionId.trim() : generateTxnId(paymentMethod),
        payerName: payerName || req.session.user.name,
        payerNumber: payerNumber || req.session.user.phone || null,
        invoiceNo: generateInvoiceNo(),
        TeamId: team.id
      }, { transaction: t });
    }

    const qrData = `Reg:${team.regRef}|Tournament:${tournament.name}|Team:${team.name}|Fee:${fee}`;
    team.qrCode = await QRCode.toDataURL(qrData);
    await team.save({ transaction: t });

    await t.commit();

    // Best-effort notifications - never block the response on these
    Notification.create({
      title: fee > 0 ? 'Tournament Registration Received' : 'Tournament Registration Confirmed',
      message: fee > 0
        ? `Team "${team.name}" is registered for ${tournament.name}. Entry fee ৳${fee} is awaiting verification.`
        : `Team "${team.name}" is confirmed for ${tournament.name}.`,
      type: fee > 0 ? 'info' : 'success',
      UserId: req.session.user.id
    }).catch(() => {});
    sendMail(team.captainEmail || req.session.user.email, `Tournament Registration - ${tournament.name}`,
      `<h2>Registration ${team.status === 'confirmed' ? 'Confirmed' : 'Received'}</h2>
       <p>Ref: <strong>${team.regRef}</strong></p>
       <p>Team: ${team.name} &middot; ${tournament.name}</p>
       <p>Entry fee: ৳${fee}${payment ? ` (${payment.method}, invoice ${payment.invoiceNo})` : ''}</p>
       ${fee > 0 ? '<p>Your payment will be verified by the organiser shortly.</p>' : ''}`
    ).catch(() => {});
    sendSMS(team.captainPhone, `Team ${team.name} registered for ${tournament.name}. Ref ${team.regRef}`).catch(() => {});

    req.flash('success', fee > 0
      ? `Team registered! Reference: ${team.regRef}. Your entry fee of ৳${fee} is pending verification.`
      : `Team registered and confirmed! Reference: ${team.regRef}.`);
    res.redirect(`/my-tournaments/${team.id}`);
  } catch (err) {
    await t.rollback();
    console.error(err);
    // A clashing transactionId means someone already submitted that exact payment reference
    const msg = err.name === 'SequelizeUniqueConstraintError'
      ? 'That Transaction ID has already been used for another registration. Please check and enter the correct one.'
      : (err.message || 'Registration failed. Please try again.');
    req.flash('error', msg);
    res.redirect(back);
  }
});

module.exports = router;
