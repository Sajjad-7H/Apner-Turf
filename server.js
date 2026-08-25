require('dotenv').config();
const express = require('express');
// Patches Express to forward errors thrown inside async route handlers to the error-handling
// middleware automatically. Without this, an unhandled rejection in an `async (req, res) => {}`
// route (e.g. a database error) never sends a response at all - the browser just spins forever
// instead of showing the "Something went wrong" page. Must be required before the routes below.
require('express-async-errors');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');

const { sequelize } = require('./models');
const { getAllSettings } = require('./utils/helpers');
const { fixDatabase, cleanupBackupTables } = require('./utils/dbFix');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'partials/layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// On Vercel, each request can be handled by a totally different, isolated server
// instance - there's no single long-running process. express-session's default
// MemoryStore keeps sessions in that one instance's RAM, so a login recorded by
// instance A is invisible to instance B, and the very next click can look logged
// out (or "Admin access required" even for an admin who just logged in). Storing
// sessions in Postgres instead makes them visible to every instance.
let sessionStore;
if (sequelize.getDialect() === 'postgres') {
  const pgSession = require('connect-pg-simple')(session);
  const { Pool } = require('pg');
  sessionStore = new pgSession({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL,
      ssl: { require: true, rejectUnauthorized: false }
    }),
    createTableIfMissing: true
  });
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'turf_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

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

async function migrate() {
  await cleanupBackupTables(sequelize).catch(err =>
    console.warn('[dbFix] Backup table cleanup skipped:', err.message));

  const isSqlite = sequelize.getDialect() === 'sqlite';
  if (isSqlite) await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sequelize.authenticate();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[db] Connection attempt ${attempt} failed: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    if (lastErr) throw lastErr;

    await sequelize.sync();
  } finally {
    if (isSqlite) await sequelize.query('PRAGMA foreign_keys = ON');
  }
  await fixDatabase(sequelize);
}

const migrationReady = migrate().catch(err => {
  console.error('Failed to sync database:', err);
  throw err;
});

app.use(async (req, res, next) => {
  try {
    await migrationReady;
    next();
  } catch (err) {
    res.status(500).send('Database is not ready: ' + err.message);
  }
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/public'));
app.use('/', require('./routes/booking'));
app.use('/', require('./routes/tournament'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('user/404', { title: 'Page Not Found', layout: 'partials/layout' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong: ' + err.message);
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  migrationReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Turf Booking server running at http://localhost:${PORT}`);
      });
    })
    .catch(() => {});
}

module.exports = app;
