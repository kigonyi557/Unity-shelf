const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

async function sendMail({ to, subject, text, html }) {
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM || 'library@example.com', to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendMail };
