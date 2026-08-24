require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, Turf, Coupon, Tournament } = require('../models');
const { setSetting } = require('../utils/helpers');
const { fixDatabase } = require('../utils/dbFix');

async function seed() {
  await sequelize.sync({ alter: true });
  await fixDatabase(sequelize);

  // Default site settings (admin can edit anytime from /admin/settings)
  await setSetting('siteName', 'Apnar Turf');
  await setSetting('tagline', 'Book Your Turf, Play Your Game');
  await setSetting('contactEmail', 'info@apnarturf.com');
  await setSetting('contactPhone', '01700000000');
  await setSetting('address', 'Dhaka, Bangladesh');

  // Admin account
  const adminExists = await User.findOne({ where: { email: 'admin@turf.com' } });
  if (!adminExists) {
    await User.create({
      name: 'Site Admin',
      email: 'admin@turf.com',
      phone: '01700000001',
      password: await bcrypt.hash('admin123', 10),
      role: 'admin'
    });
    console.log('Admin created: admin@turf.com / admin123');
  }

  // Demo user
  const userExists = await User.findOne({ where: { email: 'user@turf.com' } });
  if (!userExists) {
    await User.create({
      name: 'Demo User',
      email: 'user@turf.com',
      phone: '01800000002',
      password: await bcrypt.hash('user123', 10),
      role: 'user'
    });
    console.log('Demo user created: user@turf.com / user123');
  }

  // Sample turfs
  const turfCount = await Turf.count();
  if (turfCount === 0) {
    await Turf.bulkCreate([
      {
        name: 'Green Arena Turf', type: 'Football', indoorOutdoor: 'Outdoor', capacity: 14,
        location: 'Mirpur, Dhaka', pricePerHour: 1500, weekendPrice: 2000, peakHourPrice: 1800,
        peakHourStart: '18:00', peakHourEnd: '22:00', openingTime: '06:00', closingTime: '24:00',
        description: 'Premium outdoor football turf with floodlights, ideal for 7-a-side matches.',
        facilities: JSON.stringify(['Parking', 'Changing Room', 'Washroom', 'Flood Light', 'Drinking Water', 'Canteen'])
      },
      {
        name: 'City Cricket Ground', type: 'Cricket', indoorOutdoor: 'Outdoor', capacity: 22,
        location: 'Uttara, Dhaka', pricePerHour: 2000, weekendPrice: 2500, peakHourPrice: 2200,
        peakHourStart: '17:00', peakHourEnd: '21:00', openingTime: '07:00', closingTime: '23:00',
        description: 'Well-maintained cricket ground with practice nets and pavilion.',
        facilities: JSON.stringify(['Parking', 'Washroom', 'Drinking Water', 'Practice Nets'])
      },
      {
        name: 'Indoor Multi-Sport Arena', type: 'Both', indoorOutdoor: 'Indoor', capacity: 10,
        location: 'Gulshan, Dhaka', pricePerHour: 1200, weekendPrice: 1600, peakHourPrice: 1400,
        peakHourStart: '19:00', peakHourEnd: '23:00', openingTime: '08:00', closingTime: '24:00',
        description: 'Fully air-conditioned indoor turf, perfect for football and cricket practice.',
        facilities: JSON.stringify(['Parking', 'Changing Room', 'Washroom', 'AC', 'Canteen'])
      }
    ]);
    console.log('Sample turfs created.');
  }

  // Sample coupon
  const couponExists = await Coupon.findOne({ where: { code: 'WELCOME10' } });
  if (!couponExists) {
    await Coupon.create({ code: 'WELCOME10', discountType: 'percent', discountValue: 10, maxUses: 100 });
    console.log('Sample coupon created: WELCOME10 (10% off)');
  }

  // Sample tournament
  const tournamentExists = await Tournament.count();
  if (tournamentExists === 0) {
    await Tournament.create({
      name: 'Apnar Turf Football Cup 2026', sport: 'Football',
      startDate: '2026-10-01', endDate: '2026-10-10',
      entryFee: 3000, maxTeams: 16,
      description: 'Annual 7-a-side football tournament open to all registered teams.'
    });
    console.log('Sample tournament created.');
  }

  console.log('Seeding complete.');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
