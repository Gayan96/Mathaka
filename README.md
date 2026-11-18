# Mathaka Gift Shop website

A mobile-friendly gift shop website with WhatsApp ordering and a browser-based admin dashboard.
Plain HTML, CSS and JavaScript. No server, no database, no build step.

## How it works (read this first)

Walakulu deploys websites from a **GitHub repository or a .zip** and publishes them automatically when the repository changes. It does not offer cPanel, PHP or MySQL, so this project is built for that model:

1. All shop data lives in `data/catalog.json` and the photos in `images/`, inside your GitHub repository.
2. The admin dashboard (`yourdomain/admin/`) edits that data in your browser and **saves it to GitHub as a commit**.
3. Walakulu sees the commit and republishes the site. Changes go live **a few minutes after you press Save**, not instantly.

You never edit code or re-upload files. You log in to the dashboard, change things, and press **Save changes to website**.

## What you need

- A free GitHub account (github.com).
- A Walakulu account. Walakulu was on a waitlist when this was written, so confirm your access. It has a free Preview plan (a `walakulu.app` link) that is enough to test everything first.
- A phone or computer with a browser.

## 1. Put the project on GitHub

1. On github.com click **New repository**. Name it `mathaka-shop`. Choose Private or Public (both work). Create it.
2. Unzip this project. Open the unzipped folder so you can see `index.html`, `admin`, `css`, `js`, `data`, `images`.
3. In the new repository click **Add file → Upload files**. Drag **everything inside the folder** (not the folder itself) into the page, then click **Commit changes**.
   `index.html` must be at the top level of the repository, not inside another folder.

## 2. Publish it on Walakulu

1. In Walakulu choose **Connect GitHub**, authorise it, and pick the `mathaka-shop` repository and the `main` branch.
2. It is a plain HTML site, so there is no build command to set. Use the free preview link first and check the site opens.
3. Add your own domain (.lk or .com) in Walakulu when you are ready. Walakulu says free SSL is included, so the site opens with the padlock (HTTPS). Confirm the address starts with `https://`.
4. **Ask Walakulu support (help@walakulu.com) to confirm one thing:** "When I commit to my connected GitHub branch, is the site republished automatically, and roughly how long does it take?" The dashboard depends on this.

## 3. Create your admin access (once per device)

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → `mathaka-shop`.
   - Permissions → Repository permissions → **Contents: Read and write**.
   - Choose an expiry (for example 1 year) and write the date down. After it expires, make a new token and use "Reset this device" on the login page.
   - Copy the token (starts with `github_pat_`). GitHub shows it only once.
2. Open `https://your-site/admin/`.
3. Fill in your GitHub username, repository name (`mathaka-shop`), branch (`main`), the token, and **choose an admin password** (at least 10 characters).
4. Press **Connect and open dashboard**. From now on you log in with just the password on that device. On a new phone or computer, repeat this step.

How the login is protected: your token is encrypted in your browser with your password (PBKDF2 + AES-GCM) and is never stored in plain text or sent anywhere except GitHub. Nobody can change the shop without both access to your device's saved login and your password, or the token itself. Keep the token private, use the dashboard only on devices you trust, and use **Lock** when you finish. The dashboard locks itself after 30 minutes idle. There is no default username or password.

## 4. Add your first product

1. Dashboard → **Products → + Add product**.
2. Enter the name, item code (it suggests `MG-001`; it must be unique), category, price, description and availability.
3. Optional: add **options** (sizes or styles, each with its own price and minimum quantity).
4. Add photos. The first photo is the main photo. Use **Make main** or the arrows to reorder.
5. Press **Done**, then **Save changes to website**. Wait a few minutes and refresh your site.

Hide a product with **Hide** (use **Reactivate** to bring it back). Prices left blank show "Ask on WhatsApp".

## 5. Add your first promotional banner

Dashboard → **Banners → + Add banner**. Add an image (about 1600×700), a title, a subtitle, an optional button text and link (`#/shop` or a full `https://` address). Keep **Published** ticked. Use **Replace image** to swap the picture later, ↑ ↓ to reorder, and untick Published to hide it. Press **Save changes to website**.

## 6. Set your Polaroid prices

The product **Custom Polaroid Photo Prints** is already there with four options: **Mini, Large, Strip, Classic**. Prices and minimum quantities are blank until you set them.
Dashboard → Products → Edit "Custom Polaroid Photo Prints" → fill in each option's size, price and minimum order → Done → Save. Customers see these details on the product page before adding to cart, and are told to send their photos in the same WhatsApp chat after sending the order.

## 7. Other things you can change

- **Categories**: create, rename, hide and reorder.
- **Top Products**: choose and order the products shown on the home page.
- **Shop settings**: logo, WhatsApp number (with country code, e.g. `94742899909`), Facebook link, call numbers, email, address, announcement bar, delivery note.
  Your second number (070 20 50 499) is not published anywhere until you type it into "Second phone number".

## How ordering works for customers

1. They add items to the cart (or tap **Order on WhatsApp** on a product to order just that item).
2. They fill in name, WhatsApp number, address, city/town, postal code and optional notes. Required fields are checked first.
3. **Continue to WhatsApp** opens your business chat with the order message filled in. They must tap **Send** inside WhatsApp. The website never says the order was sent or confirmed, and the cart stays in place.
4. **Copy message** is there for anyone whose WhatsApp does not open.

Customer details are not stored by the website and there is no analytics or tracking code. Prices not set yet appear as "TBC" in the message. Delivery charges are not invented: the checkout shows your "delivery note" text instead.

## What was verified

Run on the project files here with a real Chromium browser (`tests/e2e.mjs`, 21 checks) plus 7 logic tests (`tests/unit.mjs`):

- Add a product with options and photos from the dashboard, save, and see it on the storefront; update its price and description, replace the banner, hide and reactivate it, change the WhatsApp number; all showed on the storefront after saving.
- Search by name or code, category filter, minimum quantity rules, cart, checkout validation.
- The WhatsApp link opens `wa.me/94742899909` with the exact message: item name, code, option, quantity, line total, customer WhatsApp number, address, postal code, subtotal and notes, correctly URL-encoded. Copy message produces the same text.
- No "order sent" text, cart kept, nothing saved from the checkout form, token stored encrypted, wrong password rejected, duplicate codes and non-image uploads rejected, no browser errors.

**What was not verified:** the test used a stand-in for GitHub and the host, so it did not touch the real GitHub, Walakulu, or WhatsApp. Please do a first live test yourself: add a test product from the dashboard, check it appears on your site after the republish, then order it and confirm the WhatsApp message opens on your own phone. Hide the test product afterwards.

To re-run the tests (needs Node 20+, Playwright and sharp installed): `node tests/unit.mjs` and `node tests/e2e.mjs`. The `tests` folder is not needed on the live site and can be deleted from the repository.

## Good to know

- Changes go live after the host republishes. If a change does not appear after 10 minutes, check the repository's commit list on GitHub, then check Walakulu's deploy status.
- If two devices save at the same time, the second shows "changed somewhere else". Reload the dashboard and redo the edit.
- Photos are shrunk automatically before saving to keep the site fast. Removing a photo from a product leaves the file in the repository (harmless).
- Because the catalogue is a public file on your site, never put private information in it.
- Do not rename a product's item code after customers have items in their cart. They would be removed from the cart.
- Keep the repository private if you prefer; the website files are still public once published.
- The same files work on any static host, in case you ever move away from Walakulu.

## Folder map

```
index.html            storefront
css/ js/              storefront styles and code
admin/                dashboard (admin/index.html)
data/catalog.json     products, categories, banners, settings
images/               logo, placeholder, product and banner photos
tests/                optional automated tests
```
