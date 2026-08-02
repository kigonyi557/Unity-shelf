// Sends mail via Resend's HTTPS API instead of raw SMTP.
// Railway blocks outbound SMTP on Free/Trial/Hobby plans, but this uses
// regular HTTPS (port 443), so it works on every plan.

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendMail({ to, subject, text, html }) {
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'library@example.com',
        to,
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API responded ${res.status}: ${body}`);
    }

    return true;
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendMail };