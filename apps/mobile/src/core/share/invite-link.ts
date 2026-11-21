// Invite links. The shared text is the https link on the API host (<api>/i#<token>; the token is in the fragment so the server never sees it), which a browser opens and hands to
// the app as waypoint://invite/<token>. The bare token and the app link are accepted too (paste, older invites).
// An invite token is 43 characters of base64url (contracts' InviteTokenSchema).
const TOKEN = "[A-Za-z0-9_-]{43}";
const WHOLE = new RegExp(`^(?:https://[^/\\s]+/i[/#]|waypoint://invite/)?(${TOKEN})/?$`);
const LINK_IN_TEXT = new RegExp(`(?:https://[^/\\s]+/i[/#]|waypoint://invite/)(${TOKEN})(?![A-Za-z0-9_-])`);

// The link to share. Without a configured API host (a dev build with no .env.local), the app link is the only one.
export function inviteLink(apiBase: string, token: string): string {
  const base = apiBase.replace(/\/+$/, "");
  return base === "" ? `waypoint://invite/${token}` : `${base}/i#${token}`;
}

// The token in pasted text: a whole link, a bare token, or a link inside a sentence. Anything else is null.
export function inviteTokenFromText(text: string): string | null {
  const trimmed = text.trim();
  const whole = WHOLE.exec(trimmed);
  if (whole !== null) return whole[1] ?? null;
  const inside = LINK_IN_TEXT.exec(trimmed);
  return inside?.[1] ?? null;
}
