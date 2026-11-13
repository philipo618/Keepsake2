# Keepsake — Static GitHub Pages Deployment Guide (`/Keepsake/`)

## 100% Free Static Hosting Architecture (No Cloud Billing)
Keepsake runs completely as a static React SPA on **GitHub Pages** (`https://<username>.github.io/Keepsake/`) connected directly to **Firebase Authentication** and **Cloud Firestore** on project **`project-b53c6fb8-7eac-4068-a82`** (Spark free tier):
- **Zero Server Infrastructure**: No Express server, no Cloud Run, no Cloud Functions, and no Firebase Hosting or paid Firebase Storage.
- **Mode A & Mode B Interactive Verification**:
  - Mode A opens immediately via `/Keepsake/g/:id`.
  - Mode B encrypts the greeting message, notes, signature, photos, and optional video metadata in-browser using Web Crypto API (`PBKDF2-SHA256` at 150,000 iterations + `AES-256-GCM` authenticated with `additionalData = greetingId`). Plaintext secrets stay in creator-only `greetings/{id}/secrets/verification`, while recipients verify and decrypt locally against `greetings/{id}/vault/sealed`.
- **Media Compression & Local Video Export**:
  - Uploaded device photos are compressed via HTML5 `<canvas>` into Firestore-safe JPEG Data URLs (with a `900 KB` document payload cap).
  - Audio clips up to `450 KB` embed inline; larger audio tracks can use the Built-In Studio Music Library or an External Audio URL.
  - Video Export Studio renders `.mp4` (WebCodecs + `mp4-muxer`) and `.webm` (`MediaRecorder`) locally in the browser and downloads directly to the user's device.

---

## Step 1: Verify Firebase Project & Security Rules (`project-b53c6fb8-7eac-4068-a82`)
1. Open the [Firebase Console](https://console.firebase.google.com/) and select **`project-b53c6fb8-7eac-4068-a82`**.
2. Confirm **Cloud Firestore** database `ai-studio-4f3bd88e-95e5-4469-8be1-a33cea212c13` is active on the **Spark (Free)** plan.
3. Deploy `firestore.rules` (only needed when rules change; does not use Firebase Hosting):
   ```bash
   npx eslint firestore.rules
   firebase login
   firebase deploy --only firestore:rules
   ```

## Step 2: Authorize Your GitHub Pages Domain in Firebase Auth
1. In **Firebase Console → Build → Authentication → Sign-in method**, confirm **Google** (and optionally **Anonymous**) is enabled.
2. Go to **Build → Authentication → Settings → Authorized domains** and add your GitHub Pages hostname (domain only, without `/Keepsake`):
   - `YOUR-USERNAME.github.io`
   *(Without adding your `.github.io` domain, Google Sign-In popups will be rejected by Firebase Auth with `auth/unauthorized-domain`.)*

## Step 3: Push Code to Your GitHub Repository (`Keepsake`)
```bash
git init
git add .
git commit -m "Configure Keepsake for static GitHub Pages (/Keepsake/) deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/Keepsake.git
git push -u origin main
```

## Step 4: Enable GitHub Pages (GitHub Actions)
1. Open your GitHub repository **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. The included `.github/workflows/deploy-gh-pages.yml` workflow automatically:
   - Installs npm dependencies
   - Runs `npm run lint` (`tsc --noEmit`)
   - Builds `dist/` with `base: "/Keepsake/"` (and sets `dist/404.html` `pathSegmentsToKeep = 1`)
   - Publishes `dist/` to GitHub Pages
4. Wait for the **Deploy Keepsake to GitHub Pages** workflow to complete and open `https://YOUR-USERNAME.github.io/Keepsake/`.

## Step 5: Post-Deployment Verification Checklist
1. Open `https://YOUR-USERNAME.github.io/Keepsake/` and verify images, CSS, and navigation render cleanly.
2. Refresh directly on `/Keepsake/explore`, `/Keepsake/create`, `/Keepsake/studio`, and `/Keepsake/g/<id>` to confirm `404.html` SPA fallback restores routes without 404 errors.
3. Sign in at `/Keepsake/admin` via Google Auth as the bootstrapped administrator (`dicksonphilipo63@gmail.com`) and click **Seed Default Catalog**.
4. Confirm non-admin Google accounts visiting `/Keepsake/admin` receive **Access Denied**.
5. Publish a Mode B card, open `/Keepsake/g/<id>` in a fresh incognito window, confirm wrong answers fail, and confirm valid answers decrypt the card.

## Known Static Hosting Limitations
- **Cloud Media Blob Hosting**: Multi-megabyte audio tracks (>450 KB), large high-resolution photo collections exceeding Firestore's 1 MiB document ceiling, and exported `.mp4`/`.webm` video files cannot be uploaded to server storage without paid Storage/CDN; exported videos download locally to the creator's device, and external HTTPS URLs are supported for larger audio/video assets.
- **Client-Side Mode B Brute-Force Bounds**: Retry lockouts (`3`/`5`/`10` attempts -> 60s pause) are enforced per-browser via `localStorage` rather than a centralized server rate-limiter; creators should include a custom memory question alongside birthdates for higher entropy.
- **No Server-Side Dynamic OpenGraph Previews**: Social crawlers (WhatsApp/Facebook link unfurlers) receive static meta tags from `index.html` rather than per-card dynamic OG tags.
