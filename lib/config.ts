export const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
export const extensionIds = (process.env.EXTENSION_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter((x) => /^[a-p]{32}$/.test(x));
export const allowedOrigins = [
  new URL(baseUrl).origin,
  ...extensionIds.map((id) => `chrome-extension://${id}`),
];
export const extensionRedirects = extensionIds.map(
  (id) => `https://${id}.chromiumapp.org/`,
);
