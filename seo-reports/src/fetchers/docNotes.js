const { google } = require('googleapis');
const { getAuth } = require('../googleAuth');

/**
 * Reads the team's monthly Google Doc and splits it into "Completed this
 * month" / "Planned next month" / "Pending" sections, matched by heading
 * text (case-insensitive, flexible wording). The team just writes normal
 * headings + bullet lists in the doc each month, nothing special needed.
 */
async function getDocNotes(site) {
  if (!site.googleDocId) return { done: [], next: [], pending: [] };

  const auth = getAuth(['https://www.googleapis.com/auth/documents.readonly']);
  const docs = google.docs({ version: 'v1', auth });
  const res = await docs.documents.get({ documentId: site.googleDocId });

  const lines = [];
  for (const el of res.data.body.content || []) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements || [])
      .map(e => (e.textRun && e.textRun.content) || '')
      .join('')
      .trim();
    if (!text) continue;
    const isHeading = (el.paragraph.paragraphStyle?.namedStyleType || '').includes('HEADING');
    lines.push({ text, isHeading });
  }

  const sections = { done: [], next: [], pending: [] };
  let current = null;
  const headingMap = [
    [/done|completed|this month/i, 'done'],
    [/next|upcoming|plan/i, 'next'],
    [/pending|blocked|waiting/i, 'pending']
  ];

  for (const line of lines) {
    if (line.isHeading) {
      const found = headingMap.find(([re]) => re.test(line.text));
      current = found ? found[1] : null;
      continue;
    }
    if (current && sections[current]) {
      sections[current].push(line.text.replace(/^[-*•]\s*/, ''));
    }
  }

  return sections;
}

module.exports = { getDocNotes };
