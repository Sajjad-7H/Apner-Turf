// Ensures the composite (TurfId, date, startTime) uniqueness constraint exists on
// Bookings and SlotBlocks - this is what stops the same slot being double-booked
// or double-blocked. Handles two situations:
//
//  1. A brand new database: just creates the composite unique index.
//  2. An existing SQLite database created before this fix, which may have the
//     table stuck with an incorrect UNIQUE constraint on each individual column
//     (TurfId, date, startTime each unique on their own - a Sequelize/SQLite
//     query-generator bug) instead of one unique constraint across all three
//     together. That bad schema makes every 2nd booking on the same turf fail
//     with a "TurfId must be unique" error. This rebuilds the table safely,
//     keeping all existing rows, then adds the correct composite index.
//
// Safe to run on every server start - all operations are idempotent / best-effort.

// Sequelize's SQLite `changeColumn` rebuilds a table as: create "<name>_backup", copy rows,
// DROP the original, rename the backup back. If a later model in the same sync() run throws,
// the process dies mid-sequence and a stale "<name>_backup" table survives. On the NEXT start
// that leftover still holds a foreign key to the real table, so `DROP TABLE <name>` fails with
// "FOREIGN KEY constraint failed" and the app can never boot again. Clear them out before sync.
async function cleanupBackupTables(sequelize) {
  if (sequelize.getDialect() !== 'sqlite') return;
  const tables = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%\\_backup' ESCAPE '\\'`,
    { type: sequelize.QueryTypes.SELECT }
  );
  for (const { name } of tables) {
    const base = name.replace(/_backup$/, '');
    const baseExists = await sequelize.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      { replacements: [base], type: sequelize.QueryTypes.SELECT }
    );
    if (baseExists.length) {
      // Real table survived - the backup is redundant
      await sequelize.query(`DROP TABLE \`${name}\``);
      console.log(`[dbFix] Dropped stale rebuild leftover "${name}".`);
    } else {
      // Crash happened between DROP and RENAME - the backup IS the data. Put it back.
      await sequelize.query(`ALTER TABLE \`${name}\` RENAME TO \`${base}\``);
      console.log(`[dbFix] Restored "${base}" from interrupted rebuild leftover "${name}".`);
    }
  }
}

async function tableHasBadColumnUnique(sequelize, tableName, columns) {
  if (sequelize.getDialect() !== 'sqlite') return false;
  const [rows] = await sequelize.query(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`
  );
  if (!rows || !rows[0] || !rows[0].sql) return false;
  const sql = rows[0].sql;
  // crude but effective: look for "<column> ... UNIQUE" on any of the individual columns
  return columns.some(col => new RegExp('`?' + col + '`?\\s+[^,]*\\bUNIQUE\\b', 'i').test(sql));
}

async function rebuildSqliteTableWithoutColumnUnique(sequelize, tableName) {
  const qi = sequelize.getQueryInterface();
  const cols = await sequelize.query(`PRAGMA table_info('${tableName}')`, { type: sequelize.QueryTypes.SELECT });
  if (!cols.length) return;
  const colNames = cols.map(c => c.name);

  const colDefs = cols.map(c => {
    let def = `\`${c.name}\` ${c.type}`;
    if (c.notnull) def += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT ${c.dflt_value}`;
    if (c.pk) def += ' PRIMARY KEY';
    return def;
  }).join(', ');

  const indexes = await sequelize.query(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='${tableName}' AND name NOT LIKE 'sqlite_autoindex_%'`,
    { type: sequelize.QueryTypes.SELECT }
  );

  const tmpTable = `${tableName}_fixtmp`;
  await sequelize.query(`DROP TABLE IF EXISTS \`${tmpTable}\``);
  await sequelize.query(`CREATE TABLE \`${tmpTable}\` (${colDefs})`);
  await sequelize.query(`INSERT INTO \`${tmpTable}\` (${colNames.map(c => `\`${c}\``).join(',')}) SELECT ${colNames.map(c => `\`${c}\``).join(',')} FROM \`${tableName}\``);
  await sequelize.query(`DROP TABLE \`${tableName}\``);
  await sequelize.query(`ALTER TABLE \`${tmpTable}\` RENAME TO \`${tableName}\``);

  for (const idx of indexes) {
    if (idx.sql) {
      try { await sequelize.query(idx.sql.replace(new RegExp(tmpTable, 'g'), tableName)); } catch (e) { /* ignore */ }
    }
  }
  console.log(`[dbFix] Rebuilt "${tableName}" to remove incorrect per-column UNIQUE constraints.`);
}

async function ensureCompositeUniqueIndex(sequelize, tableName, columns, indexName) {
  const qi = sequelize.getQueryInterface();
  try {
    const existing = await qi.showIndex(tableName);
    if (existing.some(i => i.name === indexName)) return; // already there
  } catch (e) { /* showIndex not supported on all dialects the same way - fall through */ }

  try {
    await qi.addIndex(tableName, columns, { unique: true, name: indexName });
    console.log(`[dbFix] Created composite unique index ${indexName} on ${tableName}(${columns.join(', ')})`);
  } catch (err) {
    // Already exists / duplicate key name - safe to ignore
    if (!/duplicate|already exists/i.test(err.message || '')) {
      console.warn(`[dbFix] Could not create index ${indexName} on ${tableName}:`, err.message);
    }
  }
}

// Teams registered before the entry-fee flow existed have no regRef and no payment record.
// Give them a reference so they still render on the "My Tournaments" screens, and confirm the
// ones that owe nothing (free tournaments) instead of leaving them stuck on "pending".
async function backfillTeamRegistrations(sequelize) {
  const { v4: uuidv4 } = require('uuid');
  const [rows] = await sequelize.query(
    `SELECT id FROM Teams WHERE regRef IS NULL OR regRef = ''`
  );
  for (const row of rows || []) {
    const ref = 'TR-' + uuidv4().split('-')[0].toUpperCase();
    await sequelize.query(`UPDATE Teams SET regRef = ? WHERE id = ?`, { replacements: [ref, row.id] });
  }
  await sequelize.query(
    `UPDATE Teams SET status = 'confirmed'
     WHERE (entryFeeAmount IS NULL OR entryFeeAmount = 0)
       AND (status IS NULL OR status = 'pending')
       AND id NOT IN (SELECT TeamId FROM Payments WHERE TeamId IS NOT NULL)`
  );
  if (rows && rows.length) console.log(`[dbFix] Backfilled ${rows.length} legacy team registration(s).`);
}

async function fixDatabase(sequelize) {
  const targets = [
    { table: 'Bookings', columns: ['TurfId', 'date', 'startTime'], indexName: 'unique_turf_slot' },
    { table: 'SlotBlocks', columns: ['TurfId', 'date', 'startTime'], indexName: 'unique_turf_blocked_slot' }
  ];

  for (const t of targets) {
    try {
      if (await tableHasBadColumnUnique(sequelize, t.table, t.columns)) {
        await rebuildSqliteTableWithoutColumnUnique(sequelize, t.table);
      }
      await ensureCompositeUniqueIndex(sequelize, t.table, t.columns, t.indexName);
    } catch (err) {
      console.warn(`[dbFix] Skipped fixing ${t.table}:`, err.message);
    }
  }

  // Backfill legacy rows FIRST so no NULL/duplicate regRefs are left before the unique index goes on.
  try {
    await backfillTeamRegistrations(sequelize);
    await ensureCompositeUniqueIndex(sequelize, 'Teams', ['regRef'], 'unique_team_reg_ref');
  } catch (err) {
    console.warn('[dbFix] Skipped team registration backfill:', err.message);
  }
}

module.exports = { fixDatabase, cleanupBackupTables };
