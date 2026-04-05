import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function testConnection() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL missing from .env");
    return;
  }

  console.log(`🔌 Testing connection to: ${url.split('@')[1] || "???"}`);

  try {
    const db = drizzle(url);
    const start = Date.now();
    await db.execute("SELECT 1");
    console.log(`✅ Success! Connected in ${Date.now() - start}ms`);
  } catch (err) {
    console.error("❌ Connection failed!");
    console.error(err);
  }
}

testConnection();
