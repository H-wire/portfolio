type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  from?: string;
};

export async function sendEmail(payload: EmailPayload) {
  const from = payload.from ?? process.env.EMAIL_FROM ?? "notifications@example.com";
  const message = { ...payload, from };

  if (!process.env.EMAIL_PROVIDER) {
    console.log("Email (dev):", message);
    return true;
  }

  // Placeholder for transactional provider integration (SES/SendGrid/etc).
  console.log("Email provider not configured; skipping send.");
  return false;
}
