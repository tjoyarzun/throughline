import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { account, session, oauthAccount, verification } from '../../../drizzle/schema/usr';
import { pooledDatabaseUrl } from '../db/resolve-url';
import { sendOtpEmail } from './send-otp';
import { redeemInvite } from './invite';

/**
 * Authentication.
 *
 * Better Auth over Auth.js v5 and Clerk — see docs/adr/0009. The decisive
 * point is that users live in OUR Postgres, so `usr.account` is both the
 * session identity and the domain entity, and `app.account_id` for RLS needs
 * no lookup.
 *
 * Better Auth's `user` model is mapped onto `usr.account`, and its own
 * `account` model (OAuth links) is renamed to `usr.oauth_account`, because
 * "account" means something different in each vocabulary and one of them had
 * to move.
 */

/**
 * Authentication uses its own connection, as the app_auth role.
 *
 * Sign-in must find a user by email before any session exists, and usr.account
 * has FORCE ROW LEVEL SECURITY — which binds the table owner too, and the
 * owner is what the application connects as in production. app_auth carries a
 * role-targeted policy permitting exactly that, and nothing else: it has no
 * grant on ratings, viewing history, notes or shares.
 *
 * Falls back to the main URL when AUTH_DATABASE_URL is unset, which is correct
 * locally (a superuser bypasses RLS) but NOT in production — see
 * docs/security.md#the-authentication-bootstrap.
 */
const resolved =
  (process.env.AUTH_DATABASE_URL
    ? { name: 'AUTH_DATABASE_URL', url: process.env.AUTH_DATABASE_URL }
    : null) ?? pooledDatabaseUrl();
if (!resolved) throw new Error('auth: no database URL configured');

const client = postgres(resolved.url, { max: 5, prepare: false });
const db = drizzle(client);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    /**
     * Keys are Better Auth's MODEL names; values are our Drizzle tables. The
     * physical table names come from the table definitions themselves
     * (usr.account, usr.auth_session, usr.oauth_account, usr.auth_verification).
     *
     * Do NOT also set modelName overrides. Naming the user model 'account'
     * collides with Better Auth's own `account` model — its OAuth links — and
     * the failure is opaque: "Field email not found in model account", because
     * the lookup resolves to the wrong one of the two. The schema map alone is
     * sufficient and unambiguous.
     */
    schema: {
      user: account,
      session,
      account: oauthAccount,
      verification,
    },
  }),
  user: {
    // Column renames only. Our table calls them display_name and avatar_url.
    fields: { name: 'displayName', image: 'avatarUrl' },
  },
  databaseHooks: {
    user: {
      create: {
        /**
         * Email-OTP sign-up supplies no name, and display_name is NOT NULL, so
         * it would land as an empty string and every greeting would read
         * "Hello, ". Seed it from the email local part; the person can change
         * it later.
         */
        before: async (user) => ({
          data: {
            ...user,
            name: user.name?.trim() || user.email.split('@')[0] || 'Someone',
            emailVerified: true,
          },
        }),
      },
    },
  },
  session: {
    // 30-day rolling with a 7-day refresh, server-side so "sign out
    // everywhere" is a delete rather than a token-revocation scheme.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24 * 7,
  },
  emailAndPassword: { enabled: false },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10,
      // A six-digit code beats a magic link on a phone: a link opens in
      // whichever browser handles mail, which is often not the one the person
      // started in, and the session lands somewhere they are not looking.
      async sendVerificationOTP({ email, otp }) {
        await sendOtpEmail(email, otp);
      },
    }),
  ],
  hooks: {
    /**
     * Invite-only, enforced BEFORE a code is ever sent.
     *
     * The obvious place is a databaseHooks.user.create hook, but the email-OTP
     * flow does not carry arbitrary fields through to user creation, so the
     * invite code never arrives there. Gating the send is better anyway: an
     * uninvited person gets an immediate, honest refusal instead of an email
     * they cannot use.
     *
     * This is server-side and unconditional. A direct POST to the endpoint hits
     * the same check — the UI is not the gate.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/email-otp/send-verification-otp') return;

      const body = (ctx.body ?? {}) as { email?: string; inviteCode?: string };
      const email = body.email?.trim().toLowerCase();
      if (!email) {
        throw new APIError('BAD_REQUEST', { message: 'An email address is required.' });
      }

      // Existing accounts sign in freely; the invite is only for the first time.
      const existing = await db
        .select({ id: account.id })
        .from(account)
        .where(eq(account.email, email))
        .limit(1);
      if (existing.length > 0) return;

      if (!body.inviteCode || !(await redeemInvite(client, body.inviteCode, email))) {
        throw new APIError('FORBIDDEN', {
          message: 'Throughline is invite-only. A valid invite code is required to sign up.',
        });
      }
    }),
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
  trustedOrigins: [process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'],
  advanced: {
    // usr.account.id is a uuid generated by the database, and it is the same id
    // RLS filters on. Letting the library generate its own id format here would
    // break every policy.
    database: { generateId: false },
  },
});

export type Auth = typeof auth;
