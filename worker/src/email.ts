// Sends email through the Resend REST API. https://resend.com/docs/api-reference/emails/send-email

import { buildEmailHtml, buildEmailText, type EmailContent } from "./emailHtml";

export interface Mailer {
  apiKey: string | undefined;
  from: string;
  fetchFn?: typeof fetch;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  content: EmailContent;
  replyTo?: string;
}

/** Sends 1 email. Throws if Resend does not accept it. */
export async function sendEmail(mailer: Mailer, message: OutgoingEmail): Promise<void> {
  if (!mailer.apiKey) {
    console.warn(`RESEND_API_KEY is not set. Email not sent: "${message.subject}".`);
    return;
  }
  const response = await (mailer.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${mailer.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: mailer.from,
      to: [message.to],
      subject: message.subject,
      html: buildEmailHtml(message.content),
      text: buildEmailText(message.content),
      ...(message.replyTo ? { reply_to: message.replyTo } : {})
    })
  });
  if (!response.ok) {
    throw new Error(`Resend error (${response.status}): ${await response.text()}`);
  }
}

/** Sends 1 email and does not throw. A saved order or message must not fail because of email. */
export async function sendEmailSafely(mailer: Mailer, message: OutgoingEmail): Promise<void> {
  try {
    await sendEmail(mailer, message);
  } catch (error) {
    console.error(`Email failed: "${message.subject}"`, error);
  }
}
