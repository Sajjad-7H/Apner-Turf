require('dotenv').config();
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'sqlite';

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
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: 'postgres',
      logging: false,
      pool: { max: 10, min: 0, idle: 10000 },
      // Aiven (and most managed Postgres hosts) require SSL and present a
      // cert not in Node's default trust store, so verification is relaxed.
      dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false }
      }
    }
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
