// Mock notifications provider - used until real Termii credentials exist
// (config.notifications.mode === 'mock', the default). Deterministic so tests are stable, same
// convention used elsewhere in this codebase (mockProvider.js for payments/idVerification):
//   - SMS: a phone number ending in '0' simulates a failed send.
//   - Email: an address containing '+fail' simulates a failed send.
// Everything else "succeeds" without making any real network call.

async function sendSms({ to, message }) {
  const fails = to.trim().endsWith('0');
  return {
    provider: 'mock',
    status: fails ? 'failed' : 'success',
    messageId: fails ? null : `mock_sms_${Date.now()}`,
    raw: { to, message, note: 'mock provider - no real API call made' },
  };
}

async function sendEmail({ to, subject, variables }) {
  const fails = to.toLowerCase().includes('+fail');
  return {
    provider: 'mock',
    status: fails ? 'failed' : 'success',
    messageId: fails ? null : `mock_email_${Date.now()}`,
    raw: { to, subject, variables, note: 'mock provider - no real API call made' },
  };
}

module.exports = { sendSms, sendEmail };
