require('dotenv').config();
const { Sequelize } = require('sequelize');

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
