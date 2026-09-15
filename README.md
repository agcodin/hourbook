# Hourbook

Track where your time goes. Log sessions on a month calendar, see totals per category, and attach a custom metric (points won, pages read, calories…) to each category.

It's a single static `index.html` with no build step or backend. Entries are saved in each visitor's own browser (`localStorage`), so everyone who opens the site gets their own private log.

## Run locally

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (for example `hourbook`).
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<you>/hourbook.git
   git push -u origin main
   ```
3. In the repository, go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save.
4. The site will be live at `https://<you>.github.io/hourbook/` within a minute or two.
