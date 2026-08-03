const { sendWhatsApp } = require('./whatsapp');
const { sendSms } = require('./sms');
const { sendMail } = require('./email');

/**
 * Sends a verification code, trying channels in order until one succeeds:
 *   1. WhatsApp (if phone provided)
 *   2. SMS (if phone provided)
 *   3. Email (if email provided)
 *
 * Returns { success: boolean, channel: 'whatsapp' | 'sms' | 'email' | null }
 */
async function sendVerificationCode({ name, phone, email, code, ttlMinutes = 15 }) {
  const messageBody = `Hi ${name}, your Unity Shelf verification code is: ${code}. It expires in ${ttlMinutes} minutes.`;

  if (phone) {
    const viaWhatsApp = await sendWhatsApp({ to: phone, body: messageBody });
    if (viaWhatsApp) return { success: true, channel: 'whatsapp' };

    const viaSms = await sendSms({ to: phone, body: messageBody });
    if (viaSms) return { success: true, channel: 'sms' };
  }

  if (email) {
    const viaEmail = await sendMail({
      to: email,
      subject: 'Verify your Unity Shelf account',
      text: `Hi ${name},\n\nYour verification code is: ${code}\n\nIt expires in ${ttlMinutes} minutes.\n\nThe Unity Shelf`,
    });
    if (viaEmail) return { success: true, channel: 'email' };
  }

  console.error(`[notify] all channels failed for ${name} (phone: ${phone || 'none'}, email: ${email || 'none'})`);
  return { success: false, channel: null };
}

module.exports = { sendVerificationCode };
