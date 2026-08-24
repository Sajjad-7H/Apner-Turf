require('dotenv').config();
const { Sequelize } = require('sequelize');

// If a Postgres connection string is present (e.g. from the Vercel Postgres / Neon
// integration) but DB_DIALECT wasn't explicitly set, default to postgres instead of
// sqlite - sqlite's file storage doesn't work on Vercel's read-only serverless filesystem.
const hasPostgresUrl = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL);
const dialect = process.env.DB_DIALECT || (hasPostgresUrl ? 'postgres' : 'sqlite');

let sequelize;

if (dialect === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: require('path').join(__dirname, '..', 'database.sqlite'),
    logging: false,
    // SQLite serialises writes anyway, and a single connection means the
    // `PRAGMA foreign_keys` toggle in server.js (which is per-connection) reliably
    // applies to the connection sync() runs on. It also avoids SQLITE_BUSY errors.
    pool: { max: 1, min: 0, idle: 10000 }
  });
} else if (dialect === 'postgres') {
  // Vercel Postgres / Neon / Supabase inject a single connection string
  // (DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL) instead of separate
  // DB_HOST/DB_USER/etc vars. Prefer that when present so the integration's
  // env vars work with zero extra config.
  const connectionString =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

  const commonOptions = {
    dialect: 'postgres',
    logging: false,
    pool: { max: 10, min: 0, idle: 10000 },
    // Managed Postgres hosts (Neon, Vercel Postgres, Aiven, Supabase) require SSL and
    // present a cert not in Node's default trust store, so verification is relaxed.
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    }
  };

  sequelize = connectionString
    ? new Sequelize(connectionString, commonOptions)
    : new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASS,
        { host: process.env.DB_HOST, port: process.env.DB_PORT, ...commonOptions }
      );
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: 'mysql',
      logging: false,
      pool: { max: 10, min: 0, idle: 10000 }
    }
  );
}

module.exports = sequelize;
