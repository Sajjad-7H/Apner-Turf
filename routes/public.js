const express = require('express');
const router = express.Router();
const { Turf, Review, Tournament, User } = require('../models');
const { getAllSettings } = require('../utils/helpers');

router.get('/', async (req, res) => {
  const turfs = await Turf.findAll({ where: { isActive: true }, include: [Review] });
  const tournaments = await Tournament.findAll({ where: { status: 'upcoming' }, limit: 3 });
  res.render('user/home', { title: 'Home', turfs, tournaments });
});

router.get('/turfs', async (req, res) => {
  const where = { isActive: true };
  if (req.query.type && req.query.type !== 'All') where.type = req.query.type;
  const turfs = await Turf.findAll({ where, include: [Review] });
  res.render('user/turfs', { title: 'All Turfs', turfs, selectedType: req.query.type || 'All' });
});

router.get('/turfs/:id', async (req, res) => {
  const turf = await Turf.findByPk(req.params.id, {
    include: [{ model: Review, include: [User] }]
  });
  if (!turf) { req.flash('error', 'Turf not found.'); return res.redirect('/turfs'); }
  const facilities = JSON.parse(turf.facilities || '[]');
  res.render('user/turf-details', { title: turf.name, turf, facilities });
});

router.get('/contact', async (req, res) => {
  res.render('user/contact', { title: 'Contact Us' });
});

// NOTE: /tournaments and /tournaments/:id live in routes/tournament.js - keep them there
// so the listing and the registration flow share one set of rules.

module.exports = router;
