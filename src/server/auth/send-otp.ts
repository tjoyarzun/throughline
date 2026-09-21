/**
 * Delivery for the sign-in code.
 *
 * There is no email provider configured yet. Rather than silently drop the
 * message, this logs the code in development and FAILS LOUDLY in production
 * when no provider is set — a sign-in flow that appears to work but never
 * delivers is worse than one that refuses.
 *
 * To enable: set RESEND_API_KEY and EMAIL_FROM. Resend is chosen because its
 * free tier covers an invite-only family app and it needs no domain
 * verification to send to your own address.
 */
export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  // In development the code goes to the log, NOT to Resend, even when a key is
  // present. Resend's unverified-domain mode only delivers to the account
  // owner's own address, so a dev sign-in as anyone else fails with a 403 that
  // looks like an auth bug. Set EMAIL_DEV_DELIVER=1 to exercise the real
  // delivery path locally.
  const devLogOnly = process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEV_DELIVER !== '1';

  if (!apiKey || !from || devLogOnly) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'sendOtpEmail: RESEND_API_KEY and EMAIL_FROM are required in production. ' +
          'Without them the code is generated but never delivered, and sign-in silently fails.',
      );
    }
    // The code goes to the server log, which is where you are.
    console.info(`\n  [auth] sign-in code for ${email}: ${otp}\n`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: email,
      subject: `${otp} is your Throughline code`,
      text: `Your sign-in code is ${otp}. It expires in 10 minutes.\n\nIf you did not ask for this, you can ignore it.`,
    }),
  });
  if (!res.ok) {
    throw new Error(`sendOtpEmail: delivery failed (${res.status}) ${await res.text()}`);
  }
}
