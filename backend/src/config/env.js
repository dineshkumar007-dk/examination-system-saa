import "dotenv/config";
export function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith("replace-") || value.startsWith("your-")) {
    const error = new Error(
      `Configure ${name} on the server before using this service.`,
    );
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return value;
}
export function appUrl() {
  const url = new URL(required("APP_URL"));
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("Production APP_URL must use HTTPS");
  return url.origin;
}
