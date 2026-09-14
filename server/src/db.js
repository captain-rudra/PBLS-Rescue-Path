import mongoose from "mongoose";

const LOCAL_FALLBACK_URI = "mongodb://127.0.0.1:27017/pbls_rescue_path";

// The one place MONGODB_URI is resolved — seed.js and create-super-admin.js
// both go through connectDB() rather than repeating this. A missing
// MONGODB_URI is a convenience fallback to a local Mongo in development
// (matches CLAUDE.md's "npm run dev" working with zero config), but in
// production it must never happen silently: a forgotten env var would
// otherwise have the server quietly start up against nothing durable.
const resolveUri = () => {
  const uri = process.env.MONGODB_URI;
  if (uri) return uri;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MONGODB_URI is not set. Refusing to fall back to a local database in production.");
  }
  return LOCAL_FALLBACK_URI;
};

export const connectDB = async (uri = resolveUri()) => {
  await mongoose.connect(uri);
  return mongoose.connection;
};

export const disconnectDB = async () => mongoose.disconnect();
