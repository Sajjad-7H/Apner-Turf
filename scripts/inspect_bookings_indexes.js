const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

db.serialize(() => {
  db.all("PRAGMA index_list('Bookings')", (err, indexes) => {
    if (err) { console.error('ERR', err); process.exit(1); }
    console.log('index_list:', JSON.stringify(indexes, null, 2));
    if (!indexes || indexes.length === 0) { db.close(); return; }
    let pending = indexes.length;
    indexes.forEach(idx => {
      db.all(`PRAGMA index_info(${idx.name})`, (err2, info) => {
        if (err2) { console.error('ERR info', err2); }
        console.log('index_info for', idx.name, JSON.stringify(info));
        pending -= 1;
        if (pending === 0) db.close();
      });
    });
  });
});
