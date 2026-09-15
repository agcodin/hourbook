# Hourbook

Track where your time goes. Log sessions on a month calendar, see totals per category, and attach a custom metric (points won, pages read, calories…) to each category.

It's a static site (`index.html` + `sync.js`) with no build step. Without sign-in, entries are saved in the visitor's browser. Signing in with Google syncs a person's log across all their devices through Firebase.

## Run locally

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178.

## Turn on sign-in and sync (Firebase)

Until `firebase-config.js` is filled in, the site works without the sign-in button.

1. Go to https://console.firebase.google.com, create a project, and skip Google Analytics if you don't need it.
2. **Add a web app:** Project settings → General → Your apps → Web (`</>`). Copy the `apiKey`, `authDomain`, `projectId`, and `appId` values into `firebase-config.js`. These values are meant to be public; the security rules below protect the data.
3. **Enable Google sign-in:** Build → Authentication → Get started → Sign-in method → Google → Enable.
4. **Authorize your domains:** Authentication → Settings → Authorized domains → add `<you>.github.io`. (`localhost` is included by default.)
5. **Create the database:** Build → Firestore Database → Create database → pick a location → start in production mode.
6. **Publish the security rules:** Firestore Database → Rules → replace the contents with [`firestore.rules`](firestore.rules) → Publish. Without this step every read and write is denied.

Each person's data lives at `users/<their uid>/categories` and `users/<their uid>/entries`, and the rules only let the signed-in owner read or write it.

**How sync behaves:**
- Anything logged in a browser before signing in is added to the account on first sign-in.
- Changes appear on other open devices within a second or two.
- Edits made offline are kept on the device and upload when it reconnects.
- Signing out removes the account's cached data from that browser.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (for example `hourbook`).
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<you>/hourbook.git
   git push -u origin main
   ```
3. In the repository, go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save.
4. The site will be live at `https://<you>.github.io/hourbook/` within a minute or two.
