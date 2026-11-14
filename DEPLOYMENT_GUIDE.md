# Keepsake2 — Static GitHub Pages & Cloudinary Deployment Guide (`/Keepsake2/`)

## 100% Serverless Static Architecture (Zero Backend & Zero Database)
Keepsake2 runs completely as a static React SPA on **GitHub Pages** (`https://<username>.github.io/Keepsake2/`) using:
- **Cloud Media & Card JSON Hosting**: **Cloudinary** direct browser unsigned uploads (`https://api.cloudinary.com/v1_1/<cloud_name>/<resource_type>/upload`).
- **Local Browser Persistence**: **IndexedDB** (`keepsake_studio_v2`) for auto-saved drafts, interrupted session recovery, temporary media blobs, published link history, studio catalog defaults, and sanitized upload logs.
- **Browser Media Processing**: HTML5 `<canvas>`, Web Audio API, `MediaRecorder`, `mp4-muxer` / WebCodecs, and Web Crypto API (`AES-256-GCM`).
- **GitHub Pages Routing**: Client-side hash routes (`#/`, `#/explore`, `#/create`, `#/studio`, `#/admin`, `#/view/<id>`, `#/view/<id>#key=<base64url>`) paired with `public/404.html` redirect restoration.
- **Zero Backend Infrastructure**: No Firebase, no Firestore, no Express server, no Cloud Run, no Cloud Functions, and no database servers.

---

## Step 1: Create a Free Cloudinary Account & Unsigned Upload Preset
1. Sign up or log in at [Cloudinary Console](https://console.cloudinary.com/).
2. Copy your **Cloud name** from the Dashboard (e.g. `my-keepsake-cloud`).
3. Open **Settings → Upload → Upload presets** and click **Add upload preset**:
   - **Upload preset name**: `Keepsake2` (verified unsigned preset on cloud `jbo6hxur`)
   - **Signing Mode**: **Unsigned** *(mandatory for browser-only uploads without an API secret)*
   - **Asset folder** *(optional)*: `keepsake`
   - **Use filename or externally defined Public ID**: **Enabled** *(confirmed working on `Keepsake2` so published card JSON URLs resolve cleanly via `/view/<cardId>`; if randomized public IDs are ever enforced, Keepsake2 automatically encodes `p_<base64url>` in the share link)*
   - **Unique filename**: **Disabled** if using externally defined Public IDs for cards, or **Enabled** alongside folder settings (Keepsake2 handles custom public IDs seamlessly)
   - **Allowed formats** *(recommended free-tier allowlist)*: `jpg, jpeg, png, webp, gif, mp4, webm, mov, mp3, wav, m4a, aac, ogg, json`
   - **Overwrite**: Disabled (prevents overwriting published cards; Keepsake2 mints a fresh `cardId` automatically when re-publishing edits)
   - **Raw file delivery**: Allowed (`json` uploads use Cloudinary `raw` resource delivery so published cards load directly from `res.cloudinary.com`)
4. **Security Rule**: Never place your Cloudinary `API Secret` in `.env`, GitHub Actions, or browser code. Unsigned browser uploads only ever use `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET`.

---

## Step 2: Configure Environment Variables

### Local Development (`.env.local`)
Copy `.env.example` to `.env.local` (pre-populated with your verified public values):
```bash
VITE_CLOUDINARY_CLOUD_NAME="jbo6hxur"
VITE_CLOUDINARY_UPLOAD_PRESET="Keepsake2"
```
*(You can also configure or override Cloudinary credentials at runtime in **Studio Settings** at `#/admin`.)*

### GitHub Repository Variables (for GitHub Actions)
In your GitHub repository **Settings → Secrets and variables → Actions → Variables** (or **Secrets**), you can optionally override:
- `VITE_CLOUDINARY_CLOUD_NAME`: defaults to `jbo6hxur`
- `VITE_CLOUDINARY_UPLOAD_PRESET`: defaults to `Keepsake2`
- `VITE_BASE_PATH` *(optional)*: `/Keepsake2/` (auto-detected from repository name by `.github/workflows/deploy-gh-pages.yml`)

---

## Step 3: Push Code & Enable GitHub Pages
```bash
git add .
git commit -m "Deploy Keepsake2 static app with Cloudinary and IndexedDB"
git branch -M main
git push -u origin main
```
1. Open **Settings → Pages** in your GitHub repository.
2. Set **Source** to **GitHub Actions**.
3. Wait for the **Deploy Keepsake2 to GitHub Pages** workflow to install (`npm ci`), typecheck (`npm run lint`), build (`npm run build` -> `dist/`), and publish to `https://<username>.github.io/Keepsake2/`.

---

## Step 4: Post-Deployment Verification
1. Open `https://<username>.github.io/Keepsake2/` and verify routes `#/explore`, `#/create`, `#/studio`, and `#/admin` load without 404 or console errors.
2. Open `#/admin` (**Studio Settings**) and run **Test Cloudinary Connection** to confirm your preset allows unsigned browser uploads.
3. Publish a **Mode A** greeting card, open the share URL in an incognito browser window, and verify photos, video, audio, and message render cleanly.
4. Publish a **Mode B** encrypted greeting card, open `#/view/<id>#key=<key>` in an incognito browser window, verify decryption succeeds, and verify that removing or altering `#key=` blocks decryption cleanly.

---

## Known Static Architecture Constraints
- **Cloudinary Free Tier File Size Limits**: Single image and raw JSON files are capped at **10 MB**; single audio/video files are capped at **100 MB** (files larger than 20 MB automatically use 6 MB chunked Cloudinary uploads).
- **Mode B Share Link Sensitivity**: In Mode B, the `AES-256-GCM` decryption key resides strictly in the URL `#key=` fragment (`#/view/<id>#key=...`) and is never sent to Cloudinary or any server. Recipients need the full link containing `#key=` (or the quiz hint if enabled) to decrypt the card.
- **No Global Cross-Device Draft Sync**: Drafts and published link history reside locally in IndexedDB unless exported as JSON backups from Studio Settings (`#/admin`).
- **Static Social Link Previews**: Crawlers unfurling shared URLs read the static OpenGraph tags from `index.html` rather than per-card server-rendered previews.
