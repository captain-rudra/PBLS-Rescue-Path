// Creates a super_admin — the one bootstrapping step that has to happen
// outside the app, since there is no sign-up route by design (CLAUDE.md:
// admins are provisioned, not self-registered). Safe to run again later to
// create additional admins; it only refuses a duplicate email.
//
// Usage:
//   node scripts/create-super-admin.js --email=jane@example.com --password=at-least-8-chars --name="Jane Doe" [--role=admin]
//
// Requires MONGODB_URI (reads server/.env via dotenv, same as the server).

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin from "../server/src/models/Admin.js";
import { hashSecret } from "../server/src/services/auth.js";
import { ROLES } from "../shared/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "server", ".env") });

const parseArgs = argv => {
  const args = {};
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
};

const main = async () => {
  const { email, password, name, role = ROLES.SUPER_ADMIN } = parseArgs(process.argv.slice(2));

  if (!email || !password || !name) {
    console.error("Usage: node scripts/create-super-admin.js --email=you@example.com --password=... --name=\"Full Name\" [--role=admin]");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Error: password must be at least 8 characters");
    process.exitCode = 1;
    return;
  }
  if (!Object.values(ROLES).includes(role)) {
    console.error(`Error: role must be one of ${Object.values(ROLES).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pbls_rescue_path");

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await Admin.findOne({ email: normalizedEmail });
  if (existing) {
    console.error(`Error: an admin with email ${normalizedEmail} already exists (id ${existing._id})`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await hashSecret(password);
  const admin = await Admin.create({ email: normalizedEmail, passwordHash, name: name.trim(), role, active: true });

  console.log(`Created ${role}: ${admin.email} (id ${admin._id})`);
  await mongoose.disconnect();
};

main().catch(async error => {
  console.error(error);
  if (mongoose?.connection.readyState) await mongoose.disconnect();
  process.exitCode = 1;
});
