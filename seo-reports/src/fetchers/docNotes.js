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
  // Order matters: "pending/blocked" is checked first since those words can
  // co-occur with "next" phrasing; "next" patterns checked before "done" so
  // "what we're going to do next month" doesn't get caught by "month" alone.
  const headingMap = [
    [/pending|blocked|waiting on/i, 'pending'],
    [/next month|going to do|upcoming|to-?do|plan(ned)?/i, 'next'],
    [/last month|this month|completed|done|what we did|what we do/i, 'done']
  ];

  for (const line of lines) {
    const found = headingMap.find(([re]) => re.test(line.text));
    // Treat any line matching a heading pattern as a section header, even if
    // the doc doesn't use a real "Heading" paragraph style — most teams just
    // type plain or bold lines like "What we do (Last Month)".
    if (found && line.text.length < 80) {
      current = found[1];
      continue;
    }
    if (current && sections[current]) {
      sections[current].push(line.text.replace(/^[-*•]\s*/, ''));
    }
  }

  return sections;
}

module.exports = { getDocNotes };
