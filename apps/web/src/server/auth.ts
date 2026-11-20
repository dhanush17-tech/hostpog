import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { account, getDb, rateLimit, session, user, verification } from "@hostpog/db";

const publicUrl = process.env.HOSTPOG_PUBLIC_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName: "HostPog",
  baseURL: process.env.BETTER_AUTH_URL ?? publicUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification, rateLimit } }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  trustedOrigins: [publicUrl],
  advanced: {
    useSecureCookies: publicUrl.startsWith("https://"),
    cookiePrefix: "hostpog",
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  // No workspace is created at sign-up: /app makes a personal one on first visit (ensurePersonalWorkspace), and someone
  // who signs up through a team invite joins that team instead of getting an empty workspace of their own.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
