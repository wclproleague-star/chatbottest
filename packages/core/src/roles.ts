// Which role somebody meant, out of everything the server actually has.
//
// Kalvard only ever hands out the roles the owner marked as self-serve, and
// that does not change. What changes here is what it knows: it can see every
// role on the server, so it can tell a role it does not hand out from a role
// that does not exist.
//
// The difference matters to the member. Asked for a role the server really
// has, "that is not something I do" is false — it is something somebody does,
// and the useful answer says who. Asked for a role nobody has, the useful
// answer is the list of what it can give.

export type RoleMatch =
  /** One of the owner's self-serve roles: Kalvard's to give, after the proof. */
  | { kind: 'self_serve'; role: { id: string; name: string } }
  /** A real role on this server that Kalvard does not hand out. */
  | { kind: 'not_mine'; role: { id: string; name: string } }
  /** Nothing on this server matches. */
  | { kind: 'unknown' };

/**
 * The role named in a message, if exactly one is.
 *
 * Exactly one, because two named roles is a question rather than a request,
 * and picking one of them would be guessing at which. The self-serve list is
 * checked first: a role that is both is Kalvard's to give.
 */
export function whichRole(
  message: string,
  selfServe: { id: string; name: string }[],
  allRoles: { id: string; name: string }[],
): RoleMatch {
  const mine = named(message, selfServe);
  const everything = named(message, allRoles);
  if (everything.length > 1) return { kind: 'unknown' };
  if (mine.length === 1) return { kind: 'self_serve', role: mine[0]! };
  if (everything.length === 1) {
    const role = everything[0]!;
    const isMine = selfServe.some((r) => r.id === role.id);
    return isMine ? { kind: 'self_serve', role } : { kind: 'not_mine', role };
  }
  return { kind: 'unknown' };
}

/** Every role whose name appears in the message, as a whole word. */
function named(
  message: string,
  roles: { id: string; name: string }[],
): { id: string; name: string }[] {
  const text = fold(message);
  return roles.filter((role) => {
    const name = fold(role.name);
    if (!name) return false;
    // A whole word, so "ttk" does not match inside "attack" and a two-word
    // role still matches the two words in order.
    return new RegExp(`(^|[^a-z0-9])${escape(name)}([^a-z0-9]|$)`).test(text);
  });
}

/** Lower case, accents removed, so "Modérateur" matches "moderateur". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
