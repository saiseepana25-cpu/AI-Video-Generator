# VideoCraft — local Google sign-in setup

The sign-in feature uses two services: Google identifies each teammate; MongoDB stores users, sessions and the single shared workspace. Gemini/ElevenLabs API keys cannot be used as Google sign-in credentials. Initial testing uses an eligible free MongoDB deployment; do not select a paid tier or enable paid add-ons.

## 1. Open the local settings file

In VS Code, open `apps/web/.env.local`. This ignored file has been created in this workspace with a random `AUTH_SECRET`. Leave that secret in the file. The committed `apps/web/.env.example` shows the setting names for a new checkout; it contains no keys.

Do not paste credentials in chat or upload them to GitHub. The app reads this web-specific file, not the prototype's root `.env.local`.

## 2. Set up Google first

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). Select the Cloud project you want to use for VideoCraft. If no project is selected, choose or create a dedicated development project; no Gemini model/billing setup is needed for this OAuth configuration.

   If Google shows a first-time welcome/Terms of Service screen, review the terms and decide whether to accept them yourself. This is Google's developer-service account setup. We need access to its OAuth client registration because VideoCraft uses Continue with Google. The agent has not accepted those terms or created an OAuth credential for you. Finish that screen before continuing to project/client setup.
2. If prompted to configure the app, use **VideoCraft** as the app name and your own support/contact email. Choose an audience that includes the team's Google accounts. A personal Gmail team generally needs **External**; **Internal** is for eligible Google Workspace organizations. Keep development/testing settings appropriate to the account.
3. Under **Clients**, create an OAuth client with application type **Web application**. Name it `VideoCraft local`.
4. Add this exact **Authorized redirect URI**:

   ```text
   http://127.0.0.1:3000/api/auth/callback/google
   ```

   If asked for an authorized JavaScript origin, use `http://127.0.0.1:3000`. This application uses server-side OAuth, not a Google button SDK. Do not substitute port 4310 or 4311. `localhost` and `127.0.0.1` are different origins; keep the browser URL, `AUTH_URL` and registered callback consistent.
5. Copy the OAuth **Client ID** and **Client secret** into the local file:

   ```dotenv
   AUTH_GOOGLE_ID=your-client-id.apps.googleusercontent.com
   AUTH_GOOGLE_SECRET=your-client-secret
   ```

6. If Google requires test users for your selected audience/testing mode, add the teammates who will test sign-in. VideoCraft separately checks its own allowlist; adding a Google test user does not grant workspace access by itself. Only `openid email profile` scopes are requested. No Drive, Gmail, offline API access or Google API refresh token is needed.

Google documents [client configuration and redirect rules](https://support.google.com/cloud/answer/15549257), [app audience](https://support.google.com/cloud/answer/15549945), and [server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Allow your team

Set exact Google account email addresses in the local file, separated by commas:

```dotenv
TEAM_ALLOWED_EMAILS=you@example.com,teammate@example.com
```

Replace the examples with your actual addresses. Matching trims surrounding spaces and ignores case; it does not grant access to an entire domain or treat Gmail aliases/dots as interchangeable. Empty or malformed configuration denies access. Google must report the account's email as verified. A previously disabled database membership requires deliberate operator restoration; logging in does not restore it.

## 4. Connect MongoDB

1. Open [MongoDB Atlas](https://cloud.mongodb.com/) and choose your development project.
2. Create or use an existing **Free** cluster. Select the Free option explicitly; if the available choices require payment, stop and review them before proceeding. Sample datasets are unnecessary.
3. Create a **database user** for this application. This differs from your Atlas website login. Grant only the database permissions needed for `videocraft_dev` (read/write and creation of this app's collections/indexes). Keep the password locally.
4. In the IP/network access list, allow the current computer's public IP. Do not use an unrestricted allow-from-anywhere rule for this local test. Update the allowed IP if your connection changes.
5. In the cluster's **Connect → Drivers** flow, choose Node.js and copy the connection string. Replace its username/password placeholders using your database user's details. URL-encode special characters in the password. Save the completed value locally as `MONGODB_URI`; leave `MONGODB_DB=videocraft_dev`.
6. Leave the configured `WORKSPACE_ID` stable and `WORKSPACE_NAME=VideoCraft team`. The first approved sign-in creates that workspace and the member record; later teammates join it. The app does not auto-promote disabled members.

Official instructions: [Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/), [connect a driver](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/), [connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

## 5. Check, then sign in

From the repository root:

```sh
npm run web:auth:check
npm run web:auth:check -- --database
npm run web:db:migrate
npm run web:db:check
npm run web:dev
```

The auth check prints only setting names/status, never their values. Its optional database flag makes a read-only ping; a successful ping does not establish write permissions or OAuth success. F03 requires an explicit database migration before sign-in; requests no longer create indexes. Stop application/worker writes while migrating. See [DATABASE_SETUP.md](DATABASE_SETUP.md) for privileges, non-destructive audits, retries and isolated tests. Restart the web server after changing environment values, then open [local sign-in](http://127.0.0.1:3000/sign-in).

Choose **Continue with Google** and complete Google's account/consent screens yourself. An approved account should reach Projects; refreshing should preserve the database session. Use **Sign out**, then verify direct `/projects`, `/calendar`, `/settings` access redirects to sign-in and `/api/v1/me` returns 401. The primary live flow was verified on 20 October 2026. The user explicitly deferred additional second-account/unapproved/disabled/expiry live checks beyond V1; existing access policies and unit coverage remain in place. F02 is complete for that revised scope; PROJECT_STATUS.md records what was actually tested.

If Google's page says `redirect_uri_mismatch`, compare the entire callback URI (scheme, host, port and path). If the sign-in button is disabled, run the local setup check. If MongoDB cannot connect, check the database user's credentials and current IP allowlist. Never post raw connection errors or a connection URI to chat.

The pinned integration is Auth.js `next-auth@5.0.0-beta.32` with the MongoDB adapter/driver versions in the web lockfile. This is the v5 integration documented by [Auth.js installation](https://authjs.dev/getting-started/installation), [Google provider](https://authjs.dev/getting-started/providers/google), and [MongoDB adapter](https://authjs.dev/getting-started/adapters/mongodb). Its prerelease status is explicit; an upgrade requires focused regression checks. No authentication library migration was introduced.
