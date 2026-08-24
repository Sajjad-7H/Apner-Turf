const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbFile = 'database.sqlite';
const backup = `database.sqlite.bak.${Date.now()}`;

if (!fs.existsSync(dbFile)) { console.error('database.sqlite not found'); process.exit(1); }
fs.copyFileSync(dbFile, backup);
console.log('Backup created:', backup);

const db = new sqlite3.Database(dbFile);

function run(sql) { return new Promise((res, rej) => db.run(sql, function(err){ if(err) rej(err); else res(this); })); }
function all(sql) { return new Promise((res, rej) => db.all(sql, (e,r)=>e?rej(e):res(r))); }

(async ()=>{
  try {
    const cols = await all("PRAGMA table_info('Bookings')");
    if (!cols || cols.length===0) { throw new Error('Bookings table not found'); }
    const colNames = cols.map(c=>c.name);
    // Build CREATE TABLE for Bookings_new without UNIQUE constraints
    const colDefs = cols.map(c=>{
      let def = `${c.name} ${c.type}`;
      if (c.notnull) def += ' NOT NULL';
      if (c.dflt_value !== null) def += ` DEFAULT ${c.dflt_value}`;
      if (c.pk) def += ' PRIMARY KEY';
      return def;
    }).join(', ');

    await run('BEGIN TRANSACTION');
    await run(`CREATE TABLE IF NOT EXISTS Bookings_new (${colDefs})`);
    await run(`INSERT INTO Bookings_new(${colNames.join(',')}) SELECT ${colNames.join(',')} FROM Bookings`);
    await run('DROP TABLE Bookings');
    await run('ALTER TABLE Bookings_new RENAME TO Bookings');

    // Recreate indexes (excluding sqlite internal autoindexes)
    const indexes = await all("SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%'");
    for (const idx of indexes) {
      if (idx.sql) {
        // replace table name in case sql references Bookings_new
        const sql = idx.sql.replace(/Bookings_new/g, 'Bookings');
        try { await run(sql); console.log('Recreated index:', idx.name); } catch(e){ console.warn('Failed to recreate index', idx.name, e.message); }
      }
    }

    await run('COMMIT');
    console.log('Rebuild completed successfully.');
    db.close();
  } catch (err) {
    console.error('Error:', err);
    try { await run('ROLLBACK'); } catch(e){}
    db.close();
    process.exit(1);
  }
})();
