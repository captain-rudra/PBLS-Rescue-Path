import mongoose from "mongoose";

export const connectDB = async (uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pbls_rescue_path") => {
  await mongoose.connect(uri);
  return mongoose.connection;
};

export const disconnectDB = async () => mongoose.disconnect();
