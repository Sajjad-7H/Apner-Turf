require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');

const { sequelize } = require('./models');
const { getAllSettings } = require('./utils/helpers');
const { fixDatabase, cleanupBackupTables } = require('./utils/dbFix');

const app = express();

// -------- View engine --------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');

// -------- Middleware --------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'turf_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// Make session user, flash messages, and site settings available to ALL views
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  try {
    res.locals.settings = await getAllSettings();
  } catch (e) {
    res.locals.settings = { siteName: 'Apnar Turf' };
  }
  next();
});

// -------- Routes --------
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/public'));
app.use('/', require('./routes/booking'));
app.use('/', require('./routes/tournament'));
app.use('/admin', require('./routes/admin'));

// -------- 404 --------
app.use((req, res) => {
  res.status(404).render('user/404', { title: 'Page Not Found', layout: 'partials/layout' });
});

// -------- Error handler --------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong: ' + err.message);
});

const PORT = process.env.PORT || 3000;

// Schema migration on startup.
//
// `sync({ alter: true })` on SQLite applies a column change by rebuilding the whole table:
// copy to `<name>_backup`, DROP the original, rename back. With foreign keys enforced, that
// DROP fails ("FOREIGN KEY constraint failed") the moment any child table holds rows pointing
// at it - e.g. a Booking referencing a User. So FK checks are turned off for the migration and
// switched back on before the server accepts traffic. `pool.max` is 1 for SQLite so both
// pragmas land on the same connection sync() uses.
async function migrate() {
  // Clears leftovers from a previously interrupted rebuild, which would otherwise
  // keep every later sync() failing. Must run before sync().
  await cleanupBackupTables(sequelize).catch(err =>
    console.warn('[dbFix] Backup table cleanup skipped:', err.message));

  const isSqlite = sequelize.getDialect() === 'sqlite';
  if (isSqlite) await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    await sequelize.sync({ alter: true });
  } finally {
    if (isSqlite) await sequelize.query('PRAGMA foreign_keys = ON');
  }
  await fixDatabase(sequelize);
}

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Turf Booking server running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to sync database:', err);
  });

module.exports = app;
