function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'Admin access required.');
    return res.redirect('/login');
  }
  next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/');
  }
  next();
}

module.exports = { requireLogin, requireAdmin, redirectIfLoggedIn };
