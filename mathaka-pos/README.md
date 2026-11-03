# Mathaka Gift Shop POS

A point-of-sale web app for Mathaka Gift Shop, Dondra, Matara. Next.js (App Router) + TypeScript + Tailwind CSS.
People sign in with GitHub; shop data (products, stock, sales, settings, invoice counter, access list, audit trail) is saved in a **separate private GitHub repository** through a server-side GitHub App. Any authorised person can sign in from any device with internet and see the same shop.

> **Status: not yet production-ready.** The code, unit/integration tests and typechecks pass here, but the app has **not** been installed with real dependencies, built, deployed, or connected to a real GitHub App and repository (see [Verification status](#verification-status)). Complete the setup below, then run the checks in section 6 before relying on it.

## How it works

```
Browser ──HTTPS──▶ Next.js server routes (/api/*) ──GitHub App installation token──▶ private data repo (data/store.json)
   ▲                  │ GitHub OAuth (web flow + PKCE) only to learn WHO you are
   └─ HttpOnly session cookie
```

- **Sign-in** uses GitHub's web application flow with `state` and S256 PKCE. A valid GitHub login is *not* enough: the username must be on the shop's access list (admin or cashier), checked on **every** request against the live store.
- **Storage** is one versioned JSON snapshot. Each change (sale, product edit, …) is one Git commit: blob → tree → commit → branch update with `force:false`. If someone else committed first, GitHub refuses and the server re-reads, re-validates (stock, idempotency, invoice number) and retries a bounded number of times. A change is reported saved only after GitHub confirms the commit.
- **Money** is integer minor units (1 Rs = 100). Totals, tax, change and invoice numbers are computed on the server. Sales keep sale-time prices, costs, tax and company details.
- Secrets (private key, client secret, session secret) exist only in server environment variables. The browser never sees a GitHub token, and nobody pastes a token into the app.

## 1. Local installation and running

Requires Node.js 20.9 or newer.

```bash
npm install            # creates package-lock.json: commit it
cp .env.example .env.local   # then fill in the values (section 2 and 3)
npm run dev            # http://localhost:3000
```

Other scripts: `npm test` (tests), `npm run typecheck`, `npm run build`, `npm start`.
If configuration is missing or invalid, the API returns one message listing every problem by variable name (never the secret values).

## 2. Create the private data repository and the GitHub App

**Data repository.** On GitHub create a new repository, e.g. `mathaka-pos-data`, visibility **Private**, and tick "Add a README" (the branch must have an initial commit). Do not put application code in it. Give access only to people who may see purchase prices and sales.

**GitHub App** (GitHub → Settings → Developer settings → GitHub Apps → New GitHub App):

| Field | Value |
|---|---|
| Homepage URL | your site URL, e.g. `https://YOUR-SITE` |
| Callback URL | `https://YOUR-SITE/api/auth/callback` (add `http://localhost:3000/api/auth/callback` as a second callback for local work) |
| Webhook | untick **Active** |
| Repository permissions | **Contents: Read and write** (Metadata: read is added automatically). Nothing else. |
| Account permissions | none |
| Where can it be installed | "Only on this account" is enough to store data. If cashiers use *other* GitHub accounts and sign-in is refused for them, switch to "Any account": they still cannot enter the shop unless you add them to the access list, and the App only has access to the repository you install it on. |

Then: **Generate a client secret**, **Generate a private key** (downloads a `.pem`), and **Install App** → *Only select repositories* → choose just the data repository. The installation ID is the number at the end of `https://github.com/settings/installations/<ID>`.

Fill `.env.local` from `.env.example`: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (the PEM; newlines may be written `\n`), `GITHUB_APP_INSTALLATION_ID`, `DATA_REPO_OWNER`, `DATA_REPO_NAME`, `DATA_REPO_BRANCH`, `SESSION_SECRET` (`openssl rand -base64 48`), `BOOTSTRAP_ADMIN_LOGIN`, `APP_BASE_URL`.
The server only ever talks to the configured owner/repo/branch/file. Browser input cannot change the target.

## 3. Deployment secrets (never committed)

`.env*` and `*.pem` are git-ignored. On your host, enter each variable in its secrets/environment settings page (for Vercel: Project → Settings → Environment Variables, mark the secret ones *Sensitive*; other Node hosts have the same idea). Set `APP_BASE_URL` to the final `https://` address. Delete the downloaded `.pem` from your computer once it is stored, and rotate the key (GitHub App page → generate a new key, delete the old) if it ever leaks.

## 4. First administrator and cashiers

- `BOOTSTRAP_ADMIN_LOGIN` is the GitHub username of the first administrator. On the very first request the server creates `data/store.json` with that single administrator. It is read from server configuration, never from "whoever visits first". It is only used when the store file does not exist yet; changing it later does not add admins.
- Sign in as that administrator, open **Settings → Who can sign in**, enter a person's GitHub username and choose *cashier* (sell and view; no purchase prices, no settings, no access changes) or *admin*. Removing a person signs them out on their next request. The last administrator cannot be removed or demoted.
- Signing out revokes that person's sessions on all devices.

## 5. Deploy to an HTTPS host

Use any host that runs Next.js server routes on Node (Vercel, Netlify, Render, Railway, a VPS with Node…). **GitHub Pages alone cannot work**: it serves static files only, so there is nowhere to keep the secrets or enforce login.

1. Push this application code to a GitHub repository (the *application* repo, separate from the data repo).
2. Import it into the host; build command `npm run build`, start `npm start` (most hosts detect this).
3. Add the environment variables (section 3), deploy, note the stable URL.
4. Make sure `APP_BASE_URL` and the GitHub App **Callback URL** both use exactly that URL (`…/api/auth/callback`). A mismatch makes GitHub refuse the sign-in.

## 6. Confirm that data really reaches the private repository

1. Sign in as the administrator, add a product, then make a sale in **POS**.
2. In GitHub open the data repository → `data/store.json` → **History**. You should see one commit per change (“Add product”, “Sale”, …).
3. Open the latest commit: the product, the sale with its invoice number and the reduced stock are in the JSON diff.
4. Unauthorised check: sign in with a GitHub account not on the list and confirm the app says it is not authorised; open `/api/store` in a private window and confirm it returns 401.

## 7. Second device

Open the site URL on another phone or computer, sign in with GitHub, and the same products, stock and sales load. Every device refreshes when it regains focus, after each of its own changes, and about every 45 seconds while visible (button ↻ for manual refresh). The header shows connection status and the last successful refresh. Changes made elsewhere can take up to ~45 seconds to appear; this is not real-time.

## 8. Backup, recovery and known limits

**Backup tab (admin):** export products (JSON), sales (CSV) and a full backup (JSON, without the access list). Import and restore both show a preview first; restore needs you to type `RESTORE`. Restore keeps the *current* access list, never lowers the invoice counter (so no invoice number repeats), and writes an audit entry, all in one commit.

**Recovery from GitHub history:** each change is a commit, so any earlier state exists in `data/store.json` → History. To roll back, open the wanted commit → view file → *Raw* → save it, then use **Backup → Restore** with that file. Do not edit `store.json` by hand while the shop is open.
Old commits keep old data, including purchase prices and removed people. Deleting something in the app does not remove it from history. Erasing it requires rewriting history or deleting the repository. Keep the repository private and its collaborator list short.

**Offline:** the interface can open offline, and the last-loaded data can be viewed read-only from a clearly labelled saved copy on the device. Carts are kept on the device. Sales **cannot** be completed offline: invoice numbers and stock are only valid once the server commits them. Sign-in, reads and saves all need internet. Saved copies are removed on sign-out or via **Settings → Clear data saved on this device**; on shared computers, use sign-out. The saved copy is not authentication and never the master copy.

**GitHub is not a database.** Known limits:
- A save takes several GitHub API calls (typically a second or two), writes are serialised by commit order, and heavy simultaneous use produces “busy, retry” messages instead of lost data.
- GitHub API rate limits apply (installation tokens have an hourly allowance); the app retries a few times and then shows when to try again.
- The whole shop is one file, capped at 8 MB (on the order of several thousand sales, depending on items per sale). Past that the server refuses new writes with a clear message.
- Plan to move to a transactional database (keeping GitHub as nightly backup) when the file passes about 4 MB, when you have more than a few tills selling at once, or when you see frequent “busy” messages.

## Reporting definitions

Timezone: shop setting, default `Asia/Colombo`. Revenue = subtotal − discount (tax excluded). Profit = revenue − cost of goods **at the time of sale**. Tax is reported separately and never counts as revenue or profit. Voided/refunded sales are excluded from all figures. Reversal policy: a sale can be voided or refunded once, by an admin only; the original sale stays with who/when/why; items return to stock only if ticked, and then exactly once.

## Receipts

58 mm, 80 mm and A4 layouts with preview, print and reprint. Printing uses the browser print dialog: choose the printer, paper size (roll width), margins None/Minimum and scale 100%. The app cannot silently control a printer.

## Tests

`npm test` runs, against an in-memory store and a fake GitHub API: authentication and authorisation, CSRF, two concurrent checkouts for the last item, duplicate checkout retries, invoice uniqueness, failed GitHub commits and rate limits, monetary validation, void/refund, import, and restore consistency.

## Verification status

Verified in the build environment (which could not reach the npm registry): `tsc` typecheck of the server and core code; 48 tests passing with `tsx --test`; the UI code type-checked only against a loose React type shim.
**Not verified:** `npm install` and the lockfile, `next build`, Tailwind output and visual layout, browser behaviour (printing, service worker, offline), a real GitHub App sign-in, real commits to a private repository, and any deployment. Unconfirmed GitHub details: that a non-fast-forward ref update returns 422 or 409 (both are treated as a conflict; GitHub's page does not say which). Treat the first real deployment as a test: complete section 6 before taking real sales.
