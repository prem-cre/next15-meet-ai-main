import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal } from "@polar-sh/better-auth";

import { db } from "@/db";
import * as schema from "@/db/schema";

import { polarClient } from "./polar";

// Build a deduplicated list of trusted origins from env vars
const trustedOriginsSet = new Set([
  "http://localhost:3000",
  process.env.BETTER_AUTH_URL,
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[]);

export const auth = betterAuth({
  // Trust all origins that the app is served from (localhost + any ngrok/prod URL)
  trustedOrigins: [...trustedOriginsSet],

  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          authenticatedUsersOnly: true,
          successUrl: "/upgrade",
        }),
        portal(),
      ],
    }),
  ],

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },

  emailAndPassword: {
    enabled: true,
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
    },
  }),
});
