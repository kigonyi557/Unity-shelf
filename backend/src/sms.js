const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// TWILIO_SMS_FROM should be your Twilio phone number, e.g. +12025551234
async function sendSms({ to, body }) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to,
      body,
    });

    return true;
  } catch (err) {
    console.error(`[sms] failed to send to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendSms };
