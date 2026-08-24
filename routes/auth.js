const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const { redirectIfLoggedIn } = require('../middleware/auth');

router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('user/register', { title: 'Register' });
});

router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, confirmPassword } = req.body;
    const email = (req.body.email || '').trim() || null;
    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/register');
    }
    const existing = email ? await User.findOne({ where: { email } }) : null;
    if (existing) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/register');
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, phone, password: hash });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    req.flash('success', `Welcome, ${user.name}!`);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed. Try again.');
    res.redirect('/register');
  }
});

router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('user/login', { title: 'Login' });
});

router.post('/login', async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;
    const loginId = (emailOrPhone || req.body.email || '').trim();
    const user = await User.findOne({ where: { [Op.or]: [{ email: loginId }, { phone: loginId }] } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    req.flash('success', `Welcome back, ${user.name}!`);
    res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed. Try again.');
    res.redirect('/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
