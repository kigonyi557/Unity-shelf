const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// TWILIO_WHATSAPP_FROM should look like: whatsapp:+14155238886 (sandbox)
// or whatsapp:+2547XXXXXXXX once you have a production WhatsApp sender.
async function sendWhatsApp({ to, body }) {
  try {
    // Twilio expects E.164 format with a "whatsapp:" prefix, e.g. whatsapp:+2547XXXXXXXX
    const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: toFormatted,
      body,
    });

    return true;
  } catch (err) {
    console.error(`[whatsapp] failed to send to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendWhatsApp };
