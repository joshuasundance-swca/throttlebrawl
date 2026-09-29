// The generic leak-scan rules, committed in the repo (docs/engineering.md, "Pre-commit hooks
// and leak scan"). Maintainer-specific patterns never live here: they come from the user-level
// git config key throttlebrawl.leakscan.deny, read by leak-scan.mjs.

/** Emails that may appear anywhere: no-reply addresses and reserved example domains. */
export const EMAIL_ALLOWLIST = [
  /^[^@\s]+@users\.noreply\.github\.com$/i,
  /^noreply@github\.com$/i,
  /^noreply@anthropic\.com$/i,
  /^git@github\.com$/i,
  /^[^@\s]+@example\.(?:com|org|net)$/i,
];

export function isAllowedEmail(email) {
  return EMAIL_ALLOWLIST.some((re) => re.test(email.trim()));
}

// Text in angle brackets, such as <name> or <owner>, is a placeholder and never a finding.
const PLACEHOLDER = /<[^<>\s]{1,40}>/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

/** Line rules: each regex's matches are findings (after placeholders are blanked). */
export const LINE_RULES = [
  {
    id: 'home-path',
    // C:\Users\<name>, C:/Users/<name> and the doubled-backslash form
    re: /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!(?:Public|Default|All Users)\b)[A-Za-z0-9._-]+/g,
  },
  {
    id: 'home-path',
    // /Users/<name> and /home/<name>, also the Git Bash and WSL forms /c/Users/<name>, /mnt/c/Users/<name>
    re: /(?:(?<![\w.-])|(?<=\/[A-Za-z]))\/(?:Users|home)\/(?!Shared\b)[A-Za-z0-9._-]+/g,
  },
  {
    id: 'private-address',
    re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254)\.\d{1,3}\.\d{1,3}\b/g,
  },
  {
    id: 'machine-name',
    re: /\b(?:DESKTOP|LAPTOP|WORKSTATION)-[A-Z0-9]{4,}\b/g,
  },
  {
    id: 'machine-name',
    // Whole dotted names only, so file names such as .env.local or notes.local.md never match.
    re: /(?<![\w.-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:local|lan|internal|corp|intranet|localdomain|home\.arpa)(?![.\w-])/g,
  },
];

/** File names that must never be committed. */
const NAME_RULES = [
  /(?:^|\/)\.env(?:\.(?!example$|sample$|template$)[^/]*)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/,
];

export function scanFileName(file) {
  return NAME_RULES.some((re) => re.test(file)) ? [{ rule: 'secret-file-name', line: 0 }] : [];
}

/** Masks a matched value so a finding never re-prints what it found. */
export function mask(value) {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 3)}${'*'.repeat(Math.min(12, value.length - 3))}`;
}

/**
 * Scans text line by line with the generic rules plus optional private deny regexes.
 * Returns findings: { rule, line, excerpt } (excerpt is masked; empty for private rules).
 * @param {string} text
 * @param {{ deny?: RegExp[] }} [options]
 * @returns {{ rule: string, line: number, excerpt: string }[]}
 */
export function scanText(text, { deny = [] } = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(PLACEHOLDER, '<>');
    for (const { id, re } of LINE_RULES) {
      for (const m of line.matchAll(re)) {
        findings.push({ rule: id, line: i + 1, excerpt: mask(m[0]) });
      }
    }
    for (const m of line.matchAll(EMAIL)) {
      if (!isAllowedEmail(m[0])) findings.push({ rule: 'email', line: i + 1, excerpt: mask(m[0]) });
    }
    deny.forEach((re, n) => {
      if (re.test(lines[i])) findings.push({ rule: `private-denylist#${n + 1}`, line: i + 1, excerpt: '' });
    });
  }
  return findings;
}

/** Pulls the email out of a git ident line such as "Name <mail> 1700000000 +0000". */
export function identEmail(ident) {
  const m = /<([^>]*)>/.exec(ident);
  return m ? m[1] : '';
}
