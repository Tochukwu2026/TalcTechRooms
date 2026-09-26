// Real Termii provider (SMS + email) - see spec/decisions-and-phasing.md > SMS Provider and
// Notifications (Phase 1). Termii's platform covers SMS, OTP, WhatsApp, voice, AND email in one
// account - this file uses both the SMS ("Messaging API") and email ("Email Product
// Notification") endpoints.
//
// IMPORTANT / NOT YET VERIFIED: written from Termii's published developer docs
// (developers.termii.com/messaging-api and developer.termii.com/email-product-notification),
// without real TERMII_API_KEY credentials to test against - same caveat pattern as
// paystackProvider.js and premblyProvider.js. Before switching TERMII_MODE from 'mock' to
// 'termii' in production:
//   1. Confirm the exact base URL/endpoint paths against Termii's current docs - the docs use a
//      placeholder BASE_URL; `https://api.ng.termii.com` below is taken from a third-party
//      integration's published config, not from Termii's own docs directly.
//   2. Register a sender ID (TERMII_SENDER_ID, alphanumeric, 3-11 chars) in the Termii dashboard -
//      SMS sends will fail without an approved one.
//   3. For email: create at least one email template and an "email configuration" in the Termii
//      dashboard, and set TERMII_EMAIL_TEMPLATE_ID / TERMII_EMAIL_CONFIGURATION_ID accordingly.
//      Termii's email endpoint is template-based, not free-text - unlike the SMS endpoint, you
//      cannot send an arbitrary subject/body without a pre-created template. The template should
//      define placeholders matching the `variables` keys this app sends (see notifications/index.js
//      for exactly what's sent for each notification type).
//   4. Run one real send of each type (SMS + email) and confirm the response shape below still
//      matches what Termii actually returns.

const config = require('../../config');

async function sendSms({ to, message }) {
  const { apiKey, senderId, baseUrl } = config.notifications.termii;

  if (!apiKey || !senderId) {
    throw new Error(
      'TERMII_API_KEY / TERMII_SENDER_ID are not set. Set TERMII_MODE=mock in .env until real ' +
        'Termii credentials and an approved sender ID are available.'
    );
  }

  const response = await fetch(`${baseUrl}/api/sms/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to,
      from: senderId,
      sms: message,
      type: 'plain',
      channel: 'generic',
    }),
  });

  const body = await response.json();

  if (!response.ok || body.code !== 'ok') {
    return { provider: 'termii', status: 'failed', messageId: null, raw: body };
  }
  return { provider: 'termii', status: 'success', messageId: body.message_id || null, raw: body };
}

async function sendEmail({ to, subject, variables }) {
  const { apiKey, emailConfigurationId, emailTemplateId, baseUrl } = config.notifications.termii;

  if (!apiKey || !emailConfigurationId || !emailTemplateId) {
    throw new Error(
      'TERMII_API_KEY / TERMII_EMAIL_CONFIGURATION_ID / TERMII_EMAIL_TEMPLATE_ID are not all ' +
        'set. Set TERMII_MODE=mock in .env until a real Termii email template + configuration ' +
        'exist in your Termii dashboard.'
    );
  }

  // `subject` and `variables` are both sent per Termii's documented request shape - `variables`
  // fills the template's own placeholders (e.g. {{booking_id}}, {{check_in}}), which must match
  // whatever placeholder names the template was actually created with in the Termii dashboard.
  const response = await fetch(`${baseUrl}/api/templates/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      email_configuration_id: emailConfigurationId,
      template_id: emailTemplateId,
      email: to,
      subject,
      variables,
    }),
  });

  const body = await response.json();

  if (!response.ok || body.code !== 'ok') {
    return { provider: 'termii', status: 'failed', messageId: null, raw: body };
  }
  return { provider: 'termii', status: 'success', messageId: body.message_id || null, raw: body };
}

module.exports = { sendSms, sendEmail };
