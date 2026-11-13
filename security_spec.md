# Security Specification — Keepsake Digital Greeting Cards Platform

## 1. Data Invariants
1. Every document ID must pass `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
2. Admin privileges are strictly verified via `/admins/{uid}` existence or verified bootstrapped email `dicksonphilipo63@gmail.com` with `request.auth.token.email_verified == true`.
3. User PII (`email`) is isolated in `/users/{userId}/private/info` and never exposed in public profiles or `greetings` documents.
4. Greeting documents (`greetings/{greetingId}`) enforce `creatorId == request.auth.uid` on creation and immutability of `creatorId` and `createdAt` on updates.
5. `greetings` list queries are strictly constrained to `isAdmin() || (isSignedIn() && resource.data.creatorId == request.auth.uid)` so no unauthenticated scraping of drafts or private links is possible.
6. Published greetings (`resource.data.status == 'published'`) are readable via `get` by direct unique ID only; drafts and unpublished greetings are readable only by their `creatorId` or an admin.
7. Plaintext verification answers (`greetings/{greetingId}/secrets/{secretId}`) are NEVER publicly readable; only the parent greeting's `creatorId` or an admin can read/write them.
8. Public interactive verification uses `greetings/{greetingId}/vault/sealed`, storing PBKDF2-SHA256 (150,000 iterations) salted step verifiers and an AES-256-GCM ciphertext authenticated with `additionalData = greetingId` derived from the answers. Public `list` on `/vault` is denied (`allow list: if false`).
9. Public updates on `/greetings/{greetingId}` are strictly forbidden except for an exact `+1` increment to `viewCount` on `published` greetings (`affectedKeys().hasOnly(['viewCount'])`).
10. Abuse reports (`/greetingReports/{reportId}`) are write-once for published greetings and readable/deletable only by administrators.
11. Categories, templates, mediaLibrary, and platformSettings are admin-write only.
12. All `createdAt` and `updatedAt` timestamps must match `request.time`.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Admin Spoof via Unverified Email**: User signs in with `email: "dicksonphilipo63@gmail.com"`, `email_verified: false` and attempts to write `/platformSettings/global` -> MUST FAIL (`PERMISSION_DENIED`).
2. **Self-Admin Escalation**: Authenticated regular user attempts `setDoc(/admins/{myUid}, { role: "super_admin" })` -> MUST FAIL (`PERMISSION_DENIED`).
3. **Cross-User Draft Read/List**: User B attempts `list` on `/greetings` without filtering by `creatorId == userB.uid` -> MUST FAIL (`PERMISSION_DENIED`).
4. **Draft Hijacking**: User B attempts `get` or `update` on User A's draft `/greetings/g1` -> MUST FAIL (`PERMISSION_DENIED`).
5. **Published Greeting Tampering**: Anonymous or User B attempts `update` on User A's published `/greetings/g1` (anything other than `viewCount == existing.viewCount + 1`) -> MUST FAIL (`PERMISSION_DENIED`).
6. **Secret Answer Extraction**: Recipient (unauthenticated or User B) attempts `get` on `/greetings/g1/secrets/verification` -> MUST FAIL (`PERMISSION_DENIED`).
7. **Vault Enumeration / Tampering**: Recipient attempts `list` on `/greetings/g1/vault` or `update` on `/greetings/g1/vault/sealed` -> MUST FAIL (`PERMISSION_DENIED`).
8. **Shadow Field Injection**: Creator attempts to create `/greetings/g1` with extra ghost field `isAdminApproved: true` -> MUST FAIL (`PERMISSION_DENIED`).
9. **CreatorId Immutability Bypass**: Creator attempts `update` changing `creatorId` to another UID -> MUST FAIL (`PERMISSION_DENIED`).
10. **Timestamp Forgery**: Creator attempts `create` on `/greetings/g1` with backdated `createdAt` != `request.time` -> MUST FAIL (`PERMISSION_DENIED`).
11. **ID Poisoning / Resource Exhaustion**: Attacker attempts `create` on `/greetings/invalid$id..123` or 10KB `title` -> MUST FAIL (`PERMISSION_DENIED`).
12. **PII Leak & Report Enumeration**: User B attempts `get` on `/users/userA/private/info` or `list` on `/greetingReports` -> MUST FAIL (`PERMISSION_DENIED`).
13. **Audit Log Tampering**: Regular user or creator attempts `delete` or `update` on `/activityLogs/log1` -> MUST FAIL (`PERMISSION_DENIED`).
