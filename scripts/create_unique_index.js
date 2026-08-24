const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

db.serialize(()=>{
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS unique_turf_slot ON Bookings (TurfId, date, startTime)", function(err){
    if (err) { console.error('ERR', err); process.exit(1); }
    console.log('unique_turf_slot created or already exists');
    db.all("PRAGMA index_list('Bookings')", (e,r)=>{ console.log('index_list:', JSON.stringify(r,null,2)); db.close(); });
  });
});
