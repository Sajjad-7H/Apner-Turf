require('dotenv').config();
// Vercel's serverless Node runtime resolves DNS with IPv6 preferred by default, and the
// handshake to Neon's endpoint over IPv6 sometimes drops mid-TLS-negotiation from there,
// surfacing as "Client network socket disconnected before secure TLS connection was
// established". Forcing IPv4 resolution avoids that path entirely. Must run before any
// module (pg included) opens a socket.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* older Node without this API - ignore */ }
const { Sequelize } = require('sequelize');
require('pg'); // force Vercel to bundle this - Sequelize requires it dynamically, which the build tracer misses

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
    pool: { max: 1, min: 0, idle: 10000 }
  });
} else if (dialect === 'postgres') {
  const connectionString =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

  const commonOptions = {
    dialect: 'postgres',
    logging: false,
    pool: { max: 10, min: 0, idle: 10000 },
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
