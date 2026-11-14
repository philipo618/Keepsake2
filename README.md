# Keepsake2 — Interactive Digital Greeting Cards & Video Gift Studio

Keepsake2 is a 100% static React + TypeScript application deployed on **GitHub Pages** (`/Keepsake2/`), powered by **Cloudinary** unsigned browser uploads, **IndexedDB** local studio persistence, **HTML5 Canvas / Web Audio / MediaRecorder / WebCodecs**, and **Web Crypto (`AES-256-GCM`)** client-side encryption.

## Architecture Highlights
- **Zero Backend & Zero Database**: Runs purely in the browser with no Node/Express server, Firebase, Firestore, Cloud Run, or Cloud Functions.
- **Direct Cloudinary Media & Card Publishing**: Supports photos (`<= 10 MB`), videos (`<= 100 MB` with `6 MB` chunked uploads `> 20 MB`), full-length audio (`<= 100 MB`), exported gift videos, and published card JSON bundles.
- **IndexedDB Studio Storage (`keepsake_studio_v2`)**: Auto-saves creator drafts, stores temporary local media blobs, tracks published share links, manages studio catalog presets, and retains sanitized upload diagnostics.
- **Mode A & Mode B Encryption**:
  - **Mode A**: Shareable public card JSON fetched directly from Cloudinary CDN.
  - **Mode B**: Encrypts the entire card payload in-browser with a fresh 256-bit `AES-256-GCM` key kept strictly in the URL fragment (`#/view/<id>#key=...`), never uploaded to Cloudinary or query strings.

## Run Locally

1. Install dependencies cleanly:
   ```bash
   npm ci
   ```
2. `.env.local` is preconfigured (or copy `.env.example` to `.env.local`) with the public Cloudinary unsigned identifiers:
   ```bash
   VITE_CLOUDINARY_CLOUD_NAME="jbo6hxur"
   VITE_CLOUDINARY_UPLOAD_PRESET="Keepsake2"
   ```
3. Start the development server on port 3000:
   ```bash
   npm run dev
   ```
4. Typecheck and build for GitHub Pages (`/Keepsake2/`):
   ```bash
   npm run lint
   npm run build
   ```

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for full Cloudinary upload preset setup and GitHub Pages deployment steps.
