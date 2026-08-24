const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[MAIL SKIPPED - no SMTP configured] To: ${to} | Subject: ${subject}`);
    return { skipped: true };
  }
  try {
    return await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (err) {
    console.error('Mail send failed:', err.message);
    return { error: err.message };
  }
}

// SMS stub - plug in Twilio / SSL Wireless / any local BD SMS gateway here later
async function sendSMS(phone, message) {
  if (process.env.SMS_ENABLED !== 'true') {
    console.log(`[SMS SKIPPED - disabled] To: ${phone} | Msg: ${message}`);
    return { skipped: true };
  }
  // TODO: integrate real SMS provider API call here
  console.log(`[SMS] To: ${phone} | Msg: ${message}`);
  return { sent: true };
}

module.exports = { sendMail, sendSMS };
