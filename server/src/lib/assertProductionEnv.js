// Refuses to start rather than merely warn: ALLOW_DEV_AUTH_BYPASS,
// DEV_ADMIN_ID and DEV_PARTICIPANT_ID are already inert in production on
// their own (requireAdmin/requireParticipant both gate the bypass on
// NODE_ENV !== "production" first), but having any of them SET at all in a
// production environment is a strong signal that a dev .env leaked into
// prod config — worth a hard failure at startup, not a silent no-op that
// could hide the same mistake indefinitely.
const DEV_ONLY_VARS = ["ALLOW_DEV_AUTH_BYPASS", "DEV_ADMIN_ID", "DEV_PARTICIPANT_ID"];

export const assertProductionEnv = (env = process.env) => {
  if (env.NODE_ENV !== "production") return;
  const leftover = DEV_ONLY_VARS.filter(name => env[name]);
  if (leftover.length > 0) {
    throw new Error(
      `Refusing to start with NODE_ENV=production while dev-only env var(s) are set: ${leftover.join(", ")}. ` +
        "These are already inert in production, but their presence means a development .env likely leaked into this environment — remove them before deploying."
    );
  }
};
