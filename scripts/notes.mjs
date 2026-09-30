// Parsing for the what-changed notes in changes/ (docs/engineering.md, "What-changed notes").
//
//   ---
//   kind: new        # new | fixed | changed | tuning | dev
//   audience: player # player | dev
//   ---
//   Cops now chase you. Go down near one and you're busted.

export const KINDS = ['new', 'fixed', 'changed', 'tuning', 'dev'];
export const AUDIENCES = ['player', 'dev'];
export const NOTE_NAME = /^changes\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** The author address on every commit Dependabot makes (seen on real Dependabot PRs). */
export const DEPENDABOT_EMAIL = '49699333+dependabot[bot]@users.noreply.github.com';

/**
 * Dependency bumps from Dependabot carry no what-changed note: nothing in them is news to a
 * player, and Dependabot cannot write one. A PR is exempt only when GitHub says Dependabot opened
 * it (prAuthor comes from the pull_request event, which a branch cannot set) AND every commit on
 * it is Dependabot's own. A person or agent who pushes to a Dependabot branch adds a note as usual.
 * @param {string | undefined} prAuthor
 * @param {string[]} commitAuthorEmails
 */
export function dependabotExempt(prAuthor, commitAuthorEmails) {
  return (
    prAuthor === 'dependabot[bot]' &&
    commitAuthorEmails.length > 0 &&
    commitAuthorEmails.every((e) => e === DEPENDABOT_EMAIL)
  );
}

/** Parses one note. Returns { kind, audience, text } or throws with a plain message. */
export function parseNote(file, source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!m) throw new Error(`${file}: missing the --- frontmatter block`);
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*([^#]*?)\s*(?:#.*)?$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2];
  }
  const text = m[2].trim();
  if (!KINDS.includes(fields.kind)) throw new Error(`${file}: kind must be one of ${KINDS.join(', ')}`);
  if (!AUDIENCES.includes(fields.audience))
    throw new Error(`${file}: audience must be one of ${AUDIENCES.join(', ')}`);
  if (!text) throw new Error(`${file}: the note has no text`);
  return { kind: fields.kind, audience: fields.audience, text };
}
