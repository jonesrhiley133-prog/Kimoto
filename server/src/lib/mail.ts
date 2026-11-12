import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    // Development fallback: with no SMTP_URL configured, print the mail to the server log.
    console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.mailFrom, to, subject, text });
}
