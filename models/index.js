const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// ---------- Settings (site-wide, admin-editable) ----------
const Settings = sequelize.define('Settings', {
  key: { type: DataTypes.STRING, unique: true, allowNull: false },
  value: { type: DataTypes.TEXT }
});

// ---------- User ----------
const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: true, unique: true },
  phone: { type: DataTypes.STRING },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('user', 'admin'), defaultValue: 'user' },
  isMember: { type: DataTypes.BOOLEAN, defaultValue: false },
  memberSince: { type: DataTypes.DATE, allowNull: true }
});

// ---------- Turf ----------
const Turf = sequelize.define('Turf', {
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.ENUM('Football', 'Cricket', 'Both'), defaultValue: 'Football' },
  indoorOutdoor: { type: DataTypes.ENUM('Indoor', 'Outdoor'), defaultValue: 'Outdoor' },
  capacity: { type: DataTypes.INTEGER, defaultValue: 10 },
  location: { type: DataTypes.STRING },
  mapEmbedUrl: { type: DataTypes.TEXT },
  pricePerHour: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1000 },
  weekendPrice: { type: DataTypes.FLOAT, allowNull: true },
  peakHourPrice: { type: DataTypes.FLOAT, allowNull: true },
  peakHourStart: { type: DataTypes.STRING, defaultValue: '18:00' },
  peakHourEnd: { type: DataTypes.STRING, defaultValue: '22:00' },
  openingTime: { type: DataTypes.STRING, defaultValue: '06:00' },
  closingTime: { type: DataTypes.STRING, defaultValue: '24:00' },
  description: { type: DataTypes.TEXT },
  image: { type: DataTypes.STRING, defaultValue: '/img/turf-placeholder.jpg' },
  facilities: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array string
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// ---------- Booking ----------
const Booking = sequelize.define('Booking', {
  date: { type: DataTypes.DATEONLY, allowNull: false },
  startTime: { type: DataTypes.STRING, allowNull: false }, // "19:00"
  endTime: { type: DataTypes.STRING, allowNull: false },   // "20:00"
  status: { type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'completed'), defaultValue: 'pending' },
  totalPrice: { type: DataTypes.FLOAT, allowNull: false },
  discountAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
  couponCode: { type: DataTypes.STRING, allowNull: true },
  bookingRef: { type: DataTypes.STRING, unique: true },
  qrCode: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.STRING, allowNull: true }
});
// NOTE: the (TurfId, date, startTime) uniqueness that prevents double-booking is enforced by a
// composite index created manually in utils/dbFix.js, AFTER the table is created - not declared
// here via Sequelize's `indexes` option. Sequelize's SQLite query generator has a bug where a
// composite unique index declared through `indexes` gets folded into the CREATE TABLE statement
// as a UNIQUE constraint on EACH individual column, which breaks all inserts. Keep it this way.

// ---------- Payment ----------
const Payment = sequelize.define('Payment', {
  method: { type: DataTypes.ENUM('bKash', 'Nagad', 'Rocket', 'Card', 'Cash'), allowNull: false },
  amount: { type: DataTypes.FLOAT, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'), defaultValue: 'pending' },
  transactionId: { type: DataTypes.STRING, unique: true },
  payerName: { type: DataTypes.STRING, allowNull: true },
  payerNumber: { type: DataTypes.STRING, allowNull: true },
  invoiceNo: { type: DataTypes.STRING, unique: true },
  // A payment belongs to EITHER a Booking (turf slot) or a Team (tournament entry fee).
  // `purpose` says which, so the admin payments screen can render the right columns
  // without having to guess from whichever foreign key happens to be null.
  purpose: { type: DataTypes.ENUM('booking', 'tournament'), defaultValue: 'booking' }
});

// ---------- Review ----------
const Review = sequelize.define('Review', {
  rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
  comment: { type: DataTypes.TEXT },
  isApproved: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// ---------- Coupon ----------
const Coupon = sequelize.define('Coupon', {
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  discountType: { type: DataTypes.ENUM('percent', 'flat'), defaultValue: 'percent' },
  discountValue: { type: DataTypes.FLOAT, allowNull: false },
  maxUses: { type: DataTypes.INTEGER, defaultValue: 100 },
  usedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  expiresAt: { type: DataTypes.DATE, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// ---------- Tournament ----------
const Tournament = sequelize.define('Tournament', {
  name: { type: DataTypes.STRING, allowNull: false },
  sport: { type: DataTypes.ENUM('Football', 'Cricket'), defaultValue: 'Football' },
  startDate: { type: DataTypes.DATEONLY },
  endDate: { type: DataTypes.DATEONLY },
  registrationDeadline: { type: DataTypes.DATEONLY, allowNull: true },
  entryFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  prizeMoney: { type: DataTypes.FLOAT, defaultValue: 0 },
  maxTeams: { type: DataTypes.INTEGER, defaultValue: 16 },
  teamSize: { type: DataTypes.INTEGER, defaultValue: 7 }, // players required per team
  venue: { type: DataTypes.STRING, allowNull: true },
  rules: { type: DataTypes.TEXT, allowNull: true },
  description: { type: DataTypes.TEXT },
  image: { type: DataTypes.STRING, defaultValue: '/img/tournament-placeholder.jpg' },
  registrationOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
  status: { type: DataTypes.ENUM('upcoming', 'ongoing', 'completed', 'cancelled'), defaultValue: 'upcoming' }
});

// ---------- Team (a tournament registration) ----------
const Team = sequelize.define('Team', {
  name: { type: DataTypes.STRING, allowNull: false },
  captainName: { type: DataTypes.STRING },
  captainPhone: { type: DataTypes.STRING },
  captainEmail: { type: DataTypes.STRING, allowNull: true },
  players: { type: DataTypes.TEXT, defaultValue: '[]' }, // JSON array of player names
  // TR-XXXXXXX shown to the user. NOT declared `unique: true` here: SQLite cannot
  // ALTER TABLE ADD a UNIQUE column, so adding this field to an existing Teams table would
  // fail on every start. The unique index is created separately in utils/dbFix.js instead.
  regRef: { type: DataTypes.STRING },
  entryFeeAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
  // pending  -> fee submitted, waiting for admin to verify the payment
  // confirmed-> admin verified the payment (or the tournament was free)
  // rejected -> admin could not verify the payment
  // withdrawn-> the captain pulled the team out
  status: { type: DataTypes.ENUM('pending', 'confirmed', 'rejected', 'withdrawn'), defaultValue: 'pending' },
  qrCode: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.STRING, allowNull: true }
});

// ---------- SlotBlock (admin manually blocks/frees specific date+time slots per turf) ----------
const SlotBlock = sequelize.define('SlotBlock', {
  date: { type: DataTypes.DATEONLY, allowNull: false },
  startTime: { type: DataTypes.STRING, allowNull: false },
  endTime: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: true }
});
// Same note as Booking above: composite unique index added manually in utils/dbFix.js.

// ---------- Notification ----------
const Notification = sequelize.define('Notification', {
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT },
  type: { type: DataTypes.ENUM('info', 'success', 'warning'), defaultValue: 'info' },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// ================= Associations =================
User.hasMany(Booking); Booking.belongsTo(User);
Turf.hasMany(Booking); Booking.belongsTo(Turf);
Booking.hasOne(Payment); Payment.belongsTo(Booking);
User.hasMany(Review); Review.belongsTo(User);
Turf.hasMany(Review); Review.belongsTo(Turf);
Tournament.hasMany(Team); Team.belongsTo(Tournament);
User.hasMany(Team); Team.belongsTo(User);
Team.hasOne(Payment); Payment.belongsTo(Team);
User.hasMany(Notification); Notification.belongsTo(User);
Turf.hasMany(SlotBlock); SlotBlock.belongsTo(Turf);

module.exports = {
  sequelize, Settings, User, Turf, Booking, Payment, Review, Coupon, Tournament, Team, Notification, SlotBlock
};
