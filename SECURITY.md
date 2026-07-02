# Security Notes

## Admin Protection

Admin pages are protected with Firebase Authentication plus a Firebase `admin: true` custom claim.
On the current free plan there are no Cloud Functions, so admin data access is enforced by Firestore
security rules that check the same claim in Firestore's server-side rules engine. The client-side route
gate is only a convenience. If a Functions-backed `/api/admin/*` surface is reintroduced later, it must
re-verify the claim on every request.

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

`firebase/firestore.rules` denies all client access by default. On the current free (Spark) plan there is
no Cloud Functions layer, so the owner-only Live POS reads and writes the `posTickets` collection directly
from the browser — allowed only for users whose Firebase ID token carries the `admin: true` custom claim.
Every other collection, including all public/business data, stays closed until a server surface is added.

## Operational Checklist

- Keep service account files out of git. Local keys belong in `.secrets/`.
- Do not use deprecated Firebase database secrets.
- Use Firebase environment/secrets for production-only values.
- Assign admin access with custom claims, not UI-only flags.
- Deploy locked-down Firestore rules before launch.
- Enable Firebase App Check before public launch.
- Decide how owner/admins will manually confirm external payments until processor webhooks exist.
- Configure retention guidance for completed orders, canceled orders, contact submissions, and logs.
