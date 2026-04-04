import { Polar } from "@polar-sh/sdk";

export const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  // Safely infer environment from NODE_ENV so local dev gets "sandbox" and Vercel gets "production"
  server: (process.env.POLAR_ENVIRONMENT as "sandbox" | "production") 
    ?? (process.env.NODE_ENV === "production" ? "production" : "sandbox"),
});
