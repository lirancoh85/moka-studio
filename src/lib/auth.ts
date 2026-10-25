/** Shared by middleware (edge) and the login route (node): both have Web Crypto. */
export const AUTH_COOKIE = "moka_studio_auth";

export async function authToken(password: string) {
  const data = new TextEncoder().encode(`moka-studio:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
