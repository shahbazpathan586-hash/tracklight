const nodemailer = require('nodemailer');
const path = require('path');

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendReportEmail(site, pdfPath, data) {
  const transport = getTransport();
  const to = (site.reportTo && site.reportTo.length ? site.reportTo : (process.env.DEFAULT_REPORT_TO || '').split(','))
    .map(s => s.trim()).filter(Boolean);

  if (!to.length) throw new Error(`No recipient configured for site "${site.id}" (reportTo or DEFAULT_REPORT_TO)`);

  const fromName = process.env.REPORT_FROM_NAME || 'SEO Reports';
  const fromEmail = process.env.REPORT_FROM_EMAIL || process.env.SMTP_USER;

  await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `${site.clientName} — ${data.monthLabel} SEO Performance Report`,
    text: `Hi,\n\nAttached is the ${data.monthLabel} SEO performance report for ${site.clientName} (${site.url}).\n\nBest,\n${fromName}`,
    attachments: [{ filename: path.basename(pdfPath), path: pdfPath }]
  });
}

module.exports = { sendReportEmail };
