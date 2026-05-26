# Notion Zillow Rentals Sync

Sync Zillow rental search results into a Notion database.

This is a [Notion Worker](https://developers.notion.com/workers/get-started/overview) that deploys to Notion to periodically run Zillow searches and sync the results into a managed Notion database. It uses [Zillapi](https://zillapi.com/), an API wrapper for Zillow (free up to 100 search results).

## Quickstart

Clone and install:

```sh
git clone https://github.com/YOUR_USERNAME/notion-zillow-rentals-sync.git
cd notion-zillow-rentals-sync
npm install
cp .env.example .env
```

Create a Zillapi account:

1. Go to [Zillapi](https://zillapi.com/).
2. Sign up for an account.
3. Create or copy your API key from the Zillapi dashboard.
4. Paste it into `.env` as `ZILLAPI_KEY`.

Create a Zillow search URL:

1. Open Zillow in your browser.
2. Search for rentals.
3. Apply your filters, map area, price range, bedrooms, home type, or other criteria.
4. Copy the full Zillow URL from your browser.
5. Paste it into `ZILLOW_SEARCHES` in `.env`.

Example `.env`:

```env
ZILLAPI_KEY=your_zillapi_key_here
ZILLOW_MAX_ITEMS=10
ZILLOW_SYNC_SCHEDULE=1d
ZILLOW_SEARCHES='[{"area":"Downtown","url":"https://www.zillow.com/homes/for_rent/?searchQueryState=..."}]'
```

Install and log in to the Notion Workers CLI:

```sh
curl -fsSL https://ntn.dev | bash
ntn login
```

Check, deploy, push env vars, and run the sync:

```sh
npm run check
ntn workers deploy
ntn workers env push --yes
ntn workers sync trigger zillowListingsSync
ntn workers sync status zillowListingsSync --no-watch
```

After deployment, Notion creates a managed database named `Zillow Rentals`.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ZILLAPI_KEY` | Yes | None | Your Zillapi API key. |
| `ZILLOW_SEARCHES` | Yes | None | JSON array of Zillow search configs. |
| `ZILLOW_MAX_ITEMS` | No | `50` | Max listings to request per search. Must be `1` through `50`. Use a low value while testing. |
| `ZILLOW_SYNC_SCHEDULE` | No | `1d` | Sync schedule, such as `30m`, `12h`, `1d`, `manual`, or `continuous`. |

`ZILLOW_SEARCHES` supports one or more searches:

```env
ZILLOW_SEARCHES='[
  {"area":"Neighborhood A","url":"https://www.zillow.com/homes/for_rent/?searchQueryState=..."},
  {"area":"Neighborhood B","url":"https://www.zillow.com/homes/for_rent/?searchQueryState=..."}
]'
```

The `area` field is optional. When provided, it is written to the `Area` property in Notion.

## What Gets Synced

Each listing is keyed by Zillow ZPID, so duplicate listings across searches are only written once.

The database includes:

- Address
- ZPID
- Area
- Price and price value
- Beds, baths, and square footage
- Zillow URL
- Listing image
- Place, latitude, and longitude
- Zestimate
- Days on Zillow
- Featured/showcase flags

The Notion page title is formatted for scanning:

```text
1100 Main St 2bd1.5ba / 1100sqft / $6600
```

The listing image is also added at the top of the page body.

## Ideas For How To Use It

- Track rentals in one neighborhood or several neighborhoods.
- Share a house-hunting database with roommates or family.
- Sort by price, beds, baths, square footage, or area.
- Build a relocation dashboard in Notion.
- Compare search areas in one database.
- Run a daily watchlist for new rentals.
- Fork the schema to add your own scoring fields, notes, or review workflow.

## Guidance For Agents

If a user asks you to install this in their Notion workspace, treat it as an end-to-end setup task. Do not assume the user has command-line, TypeScript, Notion Workers, or API-key experience.

Recommended approach:

1. Explain what you are doing in plain language before each major step.
2. Check that Node, npm, git, and the `ntn` CLI are available. Install or guide the user through installing anything missing.
3. Help the user create a Zillapi account and find their API key. Ask them to paste the key into their local `.env` file or paste it into the chat only if they are comfortable with that.
4. Help the user create or copy their Zillow search URL.
5. Edit `.env` for the user. Do not make them hand-format JSON if you can safely write the file yourself.
6. Keep `ZILLOW_MAX_ITEMS` low while testing, such as `1` or `2`, to avoid spending Zillapi credits unnecessarily.
7. Run `npm install`, `npm run check`, and `npm run build`.
8. Have the user run `ntn login` if authentication is needed. If the login command opens a browser or prints a code, explain exactly what they should do.
9. Deploy with `ntn workers deploy`.
10. Push env vars with `ntn workers env push --yes`.
11. Trigger one sync with `ntn workers sync trigger zillowListingsSync`.
12. Check status with `ntn workers sync status zillowListingsSync --no-watch`.
13. Tell the user where the Notion database was created and how to open it.

Important constraints for agents:

- Never print the user's `ZILLAPI_KEY` back into logs or chat.
- Avoid repeatedly triggering syncs while debugging. Each configured search calls Zillapi once per sync run.
- If a command fails, read the error and fix the underlying issue when possible instead of handing the user a raw stack trace.
- Prefer editing files directly for the user, especially `.env`, instead of giving abstract instructions.
- Before finishing, verify the sync status and summarize what is deployed, what schedule it uses, and how many search URLs are configured.

## Customizing

Most customization happens in `src/index.ts`.

Common changes:

- Remove properties you do not care about.
- Add calculated fields like price per square foot.
- Change the page title format.
- Change the page body markdown.
- Fetch a property details or photos endpoint if you want more than the primary search-result image.

## Limitations

- Search results usually include one primary listing image.
- More photos generally require another Zillapi endpoint per listing, which uses more credits.
- Zillow and Zillapi response fields may change over time.
- Notion Workers is currently beta, so CLI commands and SDK APIs may change.

## Development

```sh
npm run check
npm run build
```

## License

MIT
