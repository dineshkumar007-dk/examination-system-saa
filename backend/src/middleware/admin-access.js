import { digest, equal, token } from "../utils/security.js";
// Bound to the authenticated session. The frontend keeps this only in page memory.
export function issueAdminAccess(userId, sessionToken) {
  const nonce = token();
  return `${nonce}.${digest(`admin-page:${userId}:${digest(sessionToken)}:${nonce}`)}`;
}
export function validAdminAccess(value, userId, sessionToken) {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value || "")) return false;
  const [nonce, signature] = value.split(".");
  return equal(
    signature,
    digest(`admin-page:${userId}:${digest(sessionToken)}:${nonce}`),
  );
}
