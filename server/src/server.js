import "dotenv/config";
import { createApp } from "./app.js";
import { connectDB } from "./db.js";

const port = process.env.PORT || 3000;

await connectDB();
const app = createApp();
app.listen(port, () => console.log(`PBLS server listening on ${port}`));
