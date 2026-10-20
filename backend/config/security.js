// Do not add development defaults here: a missing secret is safer than a
// predictable signed token.
const UNSAFE_SECRETS = new Set(["dev_secret", "vine_secret_key", "change-me", "secret"]);

// Existing deployments may have strong secrets encoded in fewer than 32 text
// characters. Keep the fail-closed floor while allowing those installations to
// restart; rotate to 32+ random characters during the production rollout.
export const requireSecret = (name, { minLength = 24 } = {}) => {
  const value = String(process.env[name] || "").trim();
  if (!value || value.length < minLength || UNSAFE_SECRETS.has(value.toLowerCase())) {
    throw new Error(`${name} must be set to a unique secret of at least ${minLength} characters`);
  }
  return value;
};

export const getJwtSecret = () => requireSecret("JWT_SECRET");

export const validateSecurityConfiguration = () => {
  getJwtSecret();
  // Boarding credentials are validated by its login handler. Their absence
  // disables that feature safely instead of taking unrelated services down.
  if (String(process.env.DISABLE_ADMIN_AUTH || "").toLowerCase() === "true") {
    throw new Error("DISABLE_ADMIN_AUTH must not be enabled");
  }
};
