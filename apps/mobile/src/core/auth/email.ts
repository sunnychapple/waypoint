const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// " Zack@Example.COM " becomes "zack@example.com". Anything that is not an address becomes null.
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}
