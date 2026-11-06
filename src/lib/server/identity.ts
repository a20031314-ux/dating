/**
 * Who is asking, when the answer is "nobody in particular".
 *
 * Kept in a module of its own, with no imports, because both the request layer
 * and the usage store need it and the store is exercised by tests that resolve
 * relative paths only.
 */

/**
 * What a caller is called when nothing identifies it.
 *
 * Every request without a RevenueCat id lands on this one name, and nothing in
 * this repository sets the cookie that would avoid it — so in practice that is
 * every such request, from every install, sharing one row. Fine for counting,
 * where it only blurs a total. Not fine for anything that spends: an allowance
 * keyed here is one allowance for everybody, and the first person to use it up
 * takes it from all the rest.
 */
export const SHARED_ANONYMOUS_ID = "local-anonymous";

/**
 * Whether this id belongs to somebody in particular.
 *
 * Nothing may be charged against an id that does not, because it is not an
 * account — it is the absence of one, wearing a name.
 */
export function isIdentified(userId: string): boolean {
  return userId !== SHARED_ANONYMOUS_ID;
}
