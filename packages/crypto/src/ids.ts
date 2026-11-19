// Ids that appear inside signed or encrypted context: device, user, group, job, link and blob ids.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function checkId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new RangeError("bad id");
  return id;
}
