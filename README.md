# NIA Most Wanted Explorer

Unofficial viewer of both official NIA public lists. Official fields and external reporting are displayed separately.

## Deploy
1. Extract the ZIP and upload the contents of `nia_wanted_auto` to the root of a GitHub repository, including `.github`.
2. Enable GitHub Actions. In Settings → Actions → General, enable read/write workflow permissions.
3. In Settings → Pages, select Deploy from a branch, `main`, `/ (root)`.
4. In Actions, run **Refresh NIA public data**, then **Refresh public reporting** once.
5. Optional: add an X developer API bearer token as repository secret **X_BEARER_TOKEN**. The account must have recent-search access and sufficient quota/credits. Without it, news and GDELT still run; X is clearly marked not configured.

## Updates
- Both NIA lists: every 6 hours. Every advertised page is fetched; pagination duplicates, empty advertised pages, HTTP errors, and unexpected large count drops reject the entire refresh. The previous validated dataset is retained, and failures are shown on the page. A genuine drop exceeding 10% requires reviewing the source before adjusting validation.
- External reporting: hourly, oldest-attempted profiles first, 60 profiles per run. A full cycle takes approximately `ceil(record_count / 60)` runs, subject to GitHub scheduling delays and provider availability. Increase INTELLIGENCE_BATCH_SIZE in the workflow to refresh more profiles per run.
- Google News RSS and GDELT public news search return dated, linked public reporting. GDELT is one public-information discovery source, not comprehensive OSINT coverage.
- X uses the official recent-search API when configured. Only links and post metadata are retained. Search matches require manual identity/content verification.
- Successful empty searches show no matches. Failed providers keep their previous results and expose their last successful check and current failure state. No arrests, deaths, locations, or other claims are inferred from search results or written into official fields.

## Local use
```
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/update_nia.py
.venv/bin/python scripts/update_intelligence.py
python -m http.server 8000
```
Open http://localhost:8000. Keep API credentials out of HTML and repository files.

## Limits
Scheduled updates start after deployment and Actions enablement; the ZIP itself does not run jobs. News index coverage and identity matching are imperfect. Single-word names can produce ambiguous leads. NIA can retain historical listings; presence on the list does not independently establish current real-world status. No private data collection or automated location tracking is provided.


## Premium directory interface
The redesigned interface runs directly on GitHub Pages without a build step. All paths are relative to support the `/nia-wanted-viewer/` project URL.

- Lightweight inline SVG radar sweep; respects reduced motion and pauses in hidden tabs.
- Responsive card/list layouts and 24-record desktop and 12-record mobile pagination.
- Debounced, pre-indexed search across names, aliases, cases and official fields.
- Shareable search filters and deep links to individual profiles.
- Device-local bookmarks and CSV export of all filtered results.
- Native modal dialog, keyboard navigation, labeled controls and source-linked reporting tabs.
- Reporting data fetched only when its tab is opened; source photographs load lazily.
- Separate cacheable CSS/JavaScript assets; no frontend dependencies, external fonts, analytics, or build tools.

### Publish the redesign from your existing local repository
Copy the contents of the extracted `nia_wanted_auto` folder into your local repository, including `assets` and the hidden `.github` directory. Then run:

```bash
git add -A
git commit -m "Redesign NIA Explorer and optimize directory"
git push
```

Keep Pages configured for `main` and `/ (root)`. The site remains at https://naveenkrishna-d.github.io/nia-wanted-viewer/.


### Validation
```
python -m unittest discover -s tests
node --check assets/app.js
```
For optional interaction tests, install Playwright locally and its Chromium browser, start the HTTP server above, and run `node tests/browser.cjs`. The test covers pagination, search, bookmarks, reporting tabs, profile links, CSV export, empty results, reduced motion, mobile overflow, and retained data on refresh errors. External photos are intentionally blocked in this test to verify initials fallback without depending on NIA image availability.
