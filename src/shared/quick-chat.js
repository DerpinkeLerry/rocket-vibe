export const QUICK_CHAT_OPTIONS = Object.freeze([
  { id: 'what-a-save', text: 'What a save!' },
  { id: 'nice-shot', text: 'Nice shot!' },
  { id: 'great-pass', text: 'Great pass!' },
  { id: 'nice-one', text: 'Nice one!' },
  { id: 'thanks', text: 'Thanks!' },
  { id: 'sorry', text: 'Sorry!' },
  { id: 'my-bad', text: 'My bad...' },
  { id: 'no-problem', text: 'No problem.' },
  { id: 'wow', text: 'Wow!' },
  { id: 'close-one', text: 'Close one!' },
  { id: 'calculated', text: 'Calculated.' },
  { id: 'okay', text: 'Okay.' },
  { id: 'i-got-it', text: 'I got it!' },
  { id: 'defending', text: 'Defending...' },
  { id: 'take-the-shot', text: 'Take the shot!' },
  { id: 'need-boost', text: 'Need boost!' },
  { id: 'centering', text: 'Centering!' },
  { id: 'all-yours', text: 'All yours.' },
  { id: 'good-luck', text: 'Good luck!' },
  { id: 'have-fun', text: 'Have fun!' }
]);

const SAFE_QUICK_CHAT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeQuickChatOptions(value) {
  if (!Array.isArray(value)) return QUICK_CHAT_OPTIONS.map((entry) => ({ ...entry }));
  const seen = new Set();
  const options = [];
  for (const entry of value) {
    const id = String(entry?.id || '').trim().toLowerCase();
    const text = String(entry?.text || '').trim().replace(/\s+/g, ' ').slice(0, 64);
    if (!SAFE_QUICK_CHAT_ID.test(id) || !text || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, text });
    if (options.length >= 32) break;
  }
  return options.length > 0 ? options : QUICK_CHAT_OPTIONS.map((entry) => ({ ...entry }));
}

export function findQuickChat(options, id) {
  const wanted = String(id || '').trim().toLowerCase();
  return (Array.isArray(options) ? options : QUICK_CHAT_OPTIONS).find((entry) => entry.id === wanted) || null;
}
