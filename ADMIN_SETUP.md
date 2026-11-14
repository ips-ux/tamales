# Admin Setup

Firebase project: `bustostamale`. The owner logs in with Firebase Auth. An account is an owner account if it has the `admin: true` custom claim.

## Service-account key

The setup scripts in `scripts/` use a Firebase service-account key.

1. In the Firebase console, open Project settings > Service accounts.
2. Select "Generate new private key" and save the JSON file.
3. Put the file in `.secrets/` at the repository root, or set `GOOGLE_APPLICATION_CREDENTIALS` to its path.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\bustostamale-service-account.json"
```

Git ignores `.secrets/` and the common key file names. Do not commit a key.

## Create an owner account

1. In the Firebase console, open Build > Authentication.
2. Enable the Email/Password provider.
3. On the Users tab, select "Add user" and create the account.
4. Give the account the admin claim:

```powershell
npm install
npm run set-admin -- "owner@example.com"
```

5. Tell the person to log out, then log in again. The new claim is in the next ID token.

## Other scripts

| Command | Function |
| --- | --- |
| `npm run firebase:env` | Writes the Firebase web config to `.env.local`. |
| `npm run firebase:env:create` | Does the same, and creates the Firebase Web App if the project has none. |


## How admin protection works

- The Firestore rules in `firebase/firestore.rules` permit owner reads and writes only with the `admin: true` claim.
- The rules deny all public writes. The Worker makes each public write with the service-account key.
- For an owner route (`POST /api/receipts`), the browser sends the Firebase ID token. The Worker verifies the signature and the `admin` claim.
- A hidden button is not protection. The rules and the Worker are the protection.
