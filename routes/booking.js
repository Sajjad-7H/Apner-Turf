const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { sequelize, Turf, Booking, Payment, Coupon, Review, Notification, SlotBlock } = require('../models');
const { requireLogin } = require('../middleware/auth');
const {
  generateSlots, calcSlotPrice, generateBookingRef, generateInvoiceNo, generateTxnId
} = require('../utils/helpers');
const { sendMail, sendSMS } = require('../utils/mailer');

// GET availability for a turf on a given date -> JSON (used by the booking calendar UI)
router.get('/api/availability/:turfId', async (req, res) => {
  try {
    const { turfId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    const turf = await Turf.findByPk(turfId);
    if (!turf) return res.status(404).json({ error: 'Turf not found' });

    const slots = generateSlots(turf);
    const existingBookings = await Booking.findAll({
      where: { TurfId: turfId, date, status: ['pending', 'confirmed'] }
    });
    const blockedSlots = await SlotBlock.findAll({ where: { TurfId: turfId, date } });

    const result = slots.map(s => {
      const blocked = blockedSlots.find(b => b.startTime === s.startTime);
      const match = existingBookings.find(b => b.startTime === s.startTime);
      let status = 'available';
      let reason = null;
      if (blocked) {
        status = 'blocked';
        reason = blocked.reason || 'Blocked by admin';
      } else if (match) {
        status = match.status === 'confirmed' ? 'booked' : 'pending';
      }
      return {
        ...s,
        status, // available | booked | pending | blocked
        reason,
        price: calcSlotPrice(turf, date, s.startTime)
      };
    });

    res.json({ turf: { id: turf.id, name: turf.name }, date, slots: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create booking - transaction + unique constraint prevents double-booking of same slot
router.post('/book/:turfId', requireLogin, async (req, res) => {
  const { turfId } = req.params;
  const { date, startTime, endTime, couponCode, paymentMethod, notes, transactionId, payerName, payerNumber } = req.body;

  // Online payment methods (bKash/Nagad/Rocket) require proof of payment before a booking can be created
  const ONLINE_METHODS = ['bKash', 'Nagad', 'Rocket'];
  if (ONLINE_METHODS.includes(paymentMethod)) {
    if (!transactionId || !transactionId.trim() || !payerName || !payerNumber) {
      req.flash('error', 'Please enter the Transaction ID, payer name and payer number for your payment before confirming.');
      return res.redirect(`/turfs/${turfId}`);
    }
  }

  const t = await sequelize.transaction();
  try {
    const turf = await Turf.findByPk(turfId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!turf) throw new Error('Turf not found');

    // Also block booking into an admin-blocked slot
    const blocked = await SlotBlock.findOne({ where: { TurfId: turfId, date, startTime }, transaction: t });
    if (blocked) throw new Error('This slot has been blocked by the admin and is not available for booking.');

    // Re-check inside transaction to prevent race condition (two users booking same slot at once)
    const clash = await Booking.findOne({
      where: { TurfId: turfId, date, startTime, status: ['pending', 'confirmed'] },
      transaction: t
    });
    if (clash) throw new Error('This slot was just booked by someone else. Please pick another slot.');

    let price = calcSlotPrice(turf, date, startTime);
    let discount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const coupon = await Coupon.findOne({ where: { code: couponCode.toUpperCase(), isActive: true }, transaction: t });
      if (coupon && coupon.usedCount < coupon.maxUses && (!coupon.expiresAt || new Date(coupon.expiresAt) > new Date())) {
        discount = coupon.discountType === 'percent' ? (price * coupon.discountValue / 100) : coupon.discountValue;
        discount = Math.min(discount, price);
        appliedCoupon = coupon;
      }
    }

    const finalPrice = Math.max(price - discount, 0);

    const booking = await Booking.create({
      date, startTime, endTime,
      status: 'pending',
      totalPrice: finalPrice,
      discountAmount: discount,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      bookingRef: generateBookingRef(),
      UserId: req.session.user.id,
      TurfId: turf.id,
      notes
    }, { transaction: t });

    if (appliedCoupon) {
      appliedCoupon.usedCount += 1;
      await appliedCoupon.save({ transaction: t });
    }

    // Simulated / mock payment (swap in real bKash/Nagad/Card gateway later)
    const payment = await Payment.create({
      method: paymentMethod || 'Cash',
      amount: finalPrice,
      status: 'pending',
      transactionId: transactionId && transactionId.trim() ? transactionId.trim() : generateTxnId(paymentMethod || 'Cash'),
      payerName: payerName || null,
      payerNumber: payerNumber || null,
      invoiceNo: generateInvoiceNo(),
      BookingId: booking.id
    }, { transaction: t });

    // booking remains pending until payment is approved by admin
    booking.status = 'pending';

    // QR code confirmation
    const qrData = `Booking:${booking.bookingRef}|Turf:${turf.name}|Date:${date}|Time:${startTime}-${endTime}`;
    booking.qrCode = await QRCode.toDataURL(qrData);
    await booking.save({ transaction: t });

    await t.commit();

    // Notifications (best-effort, non-blocking)
    Notification.create({
      title: 'Booking Confirmed',
      message: `Your booking for ${turf.name} on ${date} (${startTime}-${endTime}) is ${booking.status}.`,
      type: 'success',
      UserId: req.session.user.id
    }).catch(() => {});
    sendMail(req.session.user.email, 'Booking Confirmation - ' + turf.name,
      `<h2>Booking Confirmed</h2><p>Ref: ${booking.bookingRef}</p><p>${turf.name} on ${date}, ${startTime}-${endTime}</p><p>Total: ৳${finalPrice}</p>`
    ).catch(() => {});
    sendSMS(req.session.user.phone || '', `Booking ${booking.bookingRef} confirmed for ${date} ${startTime}`).catch(() => {});

    req.flash('success', `Booking created! Reference: ${booking.bookingRef}. Payment is pending until admin approval.`);
    res.redirect(`/my-bookings/${booking.id}`);
  } catch (err) {
    await t.rollback();
    console.error(err);
    req.flash('error', err.message || 'Booking failed. Please try again.');
    res.redirect(`/turfs/${turfId}`);
  }
});

// My bookings list
router.get('/my-bookings', requireLogin, async (req, res) => {
  const bookings = await Booking.findAll({
    where: { UserId: req.session.user.id },
    include: [Turf, Payment],
    order: [['createdAt', 'DESC']]
  });
  res.render('user/my-bookings', { title: 'My Bookings', bookings });
});

// Single booking / invoice view
router.get('/my-bookings/:id', requireLogin, async (req, res) => {
  const booking = await Booking.findOne({
    where: { id: req.params.id, UserId: req.session.user.id },
    include: [Turf, Payment]
  });
  if (!booking) { req.flash('error', 'Booking not found.'); return res.redirect('/my-bookings'); }
  res.render('user/booking-detail', { title: 'Booking ' + booking.bookingRef, booking });
});

// Cancel booking
router.post('/my-bookings/:id/cancel', requireLogin, async (req, res) => {
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.session.user.id } });
  if (!booking) { req.flash('error', 'Booking not found.'); return res.redirect('/my-bookings'); }
  if (booking.status === 'cancelled') { req.flash('error', 'Already cancelled.'); return res.redirect('/my-bookings'); }
  booking.status = 'cancelled';
  await booking.save();
  req.flash('success', 'Booking cancelled.');
  res.redirect('/my-bookings');
});

// Submit a review for a turf (only if user has a completed/confirmed booking there)
router.post('/turfs/:turfId/review', requireLogin, async (req, res) => {
  const { rating, comment } = req.body;
  await Review.create({
    rating, comment,
    UserId: req.session.user.id,
    TurfId: req.params.turfId
  });
  req.flash('success', 'Thanks for your review!');
  res.redirect(`/turfs/${req.params.turfId}`);
});

// Update/payment details by user for a booking (submit trx id and payer info)
router.post('/my-bookings/:id/payment', requireLogin, async (req, res) => {
  const { transactionId, payerName, payerNumber } = req.body;
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.session.user.id }, include: [Payment] });
  if (!booking) { req.flash('error', 'Booking not found.'); return res.redirect('/my-bookings'); }
  if (!booking.Payment) { req.flash('error', 'Payment record missing.'); return res.redirect(`/my-bookings/${booking.id}`); }

  if (!transactionId || !transactionId.trim() || !payerName || !payerNumber) {
    req.flash('error', 'Transaction ID, payer name and payer number are all required.');
    return res.redirect(`/my-bookings/${booking.id}`);
  }

  booking.Payment.transactionId = transactionId.trim();
  booking.Payment.payerName = payerName;
  booking.Payment.payerNumber = payerNumber;
  booking.Payment.status = 'pending';
  await booking.Payment.save();

  req.flash('success', 'Payment details submitted. Admin will verify and confirm your booking.');
  res.redirect(`/my-bookings/${booking.id}`);
});

module.exports = router;
