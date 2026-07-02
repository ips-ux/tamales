# Security Notes

## Admin Protection

Admin pages and `/api/admin/*` are protected with Firebase Authentication plus Firebase custom claims.
The client gate is only a convenience; Firebase Functions must verify every privileged request server-side.

Owner/admin users should have a Firebase custom claim:

```json
{ "admin": true }
```

## Public Submission Protection

Public order and contact endpoints are handled by Firebase Functions. Add Firebase App Check before launch
to reduce automated abuse from non-app clients.

## Data Handling

- Public clients do not receive service account credentials, owner notes, customer lists, or unrestricted IDs.
- Firebase Web App config in `.env.local` is browser config, not an Admin SDK credential.
- Public confirmation links use non-guessable tokens.
- The server recalculates totals from current menu data and stores snapshots.
- No card data is collected or stored.
- POS QR codes route customers to external payment apps; they do not prove payment completion by themselves.
- Logs should avoid unnecessary personal information.

## Firestore Rules

Firestore client SDK access is denied by default in `firebase/firestore.rules`. The app reads and writes
business data through Firebase Functions using the Firebase Admin SDK.

## Operational Checklist

- Keep service account files out of git. Local keys belong in `.secrets/`.
- Do not use deprecated Firebase database secrets.
- Use Firebase environment/secrets for production-only values.
- Assign admin access with custom claims, not UI-only flags.
- Deploy locked-down Firestore rules before launch.
- Enable Firebase App Check before public launch.
- Decide how owner/admins will manually confirm external payments until processor webhooks exist.
- Configure retention guidance for completed orders, canceled orders, contact submissions, and logs.
