import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import type { Schedule } from "@notionhq/workers/types";

const worker = new Worker();
export default worker;

const ZILLAPI_BASE_URL = "https://api.zillapi.com";
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_SYNC_SCHEDULE = "1d";

const zillapi = worker.pacer("zillapi", {
	allowedRequests: 2,
	intervalMs: 60_000,
});

const zillowListings = worker.database("zillowListings", {
	type: "managed",
	initialTitle: "Zillow Rentals",
	primaryKeyProperty: "ZPID",
	schema: {
		properties: {
			Address: Schema.title(),
			ZPID: Schema.richText(),
			Area: Schema.richText(),
			Price: Schema.richText(),
			"Price Value": Schema.number(),
			Beds: Schema.number(),
			Baths: Schema.number(),
			Sqft: Schema.number(),
			Status: Schema.select([
				{ name: "FOR_RENT", color: "green" },
				{ name: "OTHER", color: "gray" },
			]),
			Street: Schema.richText(),
			City: Schema.richText(),
			State: Schema.richText(),
			Zip: Schema.richText(),
			URL: Schema.url(),
			Image: Schema.file(),
			Place: Schema.place(),
			Latitude: Schema.number(),
			Longitude: Schema.number(),
			Zestimate: Schema.number(),
			"Days on Zillow": Schema.number(),
			Featured: Schema.checkbox(),
			Showcase: Schema.checkbox(),
		},
	},
});

worker.sync("zillowListingsSync", {
	database: zillowListings,
	mode: "replace",
	schedule: syncSchedule(),
	execute: async () => {
		const listings = await searchZillow();

		return {
			changes: listings.map((listing) => ({
				type: "upsert" as const,
				key: listing.zpid,
				properties: {
					Address: Builder.title(listingTitle(listing)),
					ZPID: Builder.richText(listing.zpid),
					Area: textValue(listing.area),
					Price: textValue(listing.price),
					"Price Value": numberValue(listing.priceValue),
					Beds: numberValue(listing.beds),
					Baths: numberValue(listing.baths),
					Sqft: numberValue(listing.sqft),
					Status: Builder.select(listing.status === "FOR_RENT" ? "FOR_RENT" : "OTHER"),
					Street: textValue(listing.street),
					City: textValue(listing.city),
					State: textValue(listing.state),
					Zip: textValue(listing.zip),
					URL: urlValue(listing.detailUrl),
					Image: fileValue(listing.imageUrl, listing.address),
					Place: Builder.place({
						lat: listing.latitude,
						lon: listing.longitude,
						name: listing.address,
						address: listing.address,
					}),
					Latitude: numberValue(listing.latitude),
					Longitude: numberValue(listing.longitude),
					Zestimate: numberValue(listing.zestimate),
					"Days on Zillow": numberValue(listing.daysOnZillow),
					Featured: Builder.checkbox(listing.featured),
					Showcase: Builder.checkbox(listing.showcase),
				},
				icon: listing.imageUrl ? Builder.imageIcon(listing.imageUrl) : undefined,
				pageContentMarkdown: listingMarkdown(listing),
			})),
			hasMore: false,
		};
	},
});

type ZillapiSearchResponse = {
	data?: unknown[];
	meta?: {
		count?: number;
	};
	error?: {
		code?: string;
		message?: string;
	};
	request_id?: string;
};

type ZillowSearch = {
	area?: string;
	url: string;
};

type Listing = {
	zpid: string;
	area?: string;
	address: string;
	price?: string;
	priceValue?: number;
	beds?: number;
	baths?: number;
	sqft?: number;
	status?: string;
	street?: string;
	city?: string;
	state?: string;
	zip?: string;
	detailUrl?: string;
	imageUrl?: string;
	latitude: number;
	longitude: number;
	zestimate?: number;
	daysOnZillow?: number;
	featured: boolean;
	showcase: boolean;
};

async function searchZillow(): Promise<Listing[]> {
	const apiKey = process.env.ZILLAPI_KEY;
	if (!apiKey) {
		throw new Error("Missing ZILLAPI_KEY. Add it to .env locally and push it with `ntn workers env push`.");
	}

	const searches = zillowSearches();
	const listingsByZpid = new Map<string, Listing>();
	for (const search of searches) {
		await zillapi.wait();
		for (const listing of await searchZillowArea(apiKey, search)) {
			if (!listingsByZpid.has(listing.zpid)) {
				listingsByZpid.set(listing.zpid, listing);
			}
		}
	}

	return [...listingsByZpid.values()];
}

async function searchZillowArea(apiKey: string, search: ZillowSearch): Promise<Listing[]> {
	const response = await fetch(`${ZILLAPI_BASE_URL}/v1/search`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"User-Agent": "NotionZillowSearchSync/1.0",
		},
		body: JSON.stringify({
			searchUrls: [{ url: search.url }],
			extractionMethod: "PAGINATION",
			maxItems: maxItems(),
			async: false,
		}),
	});

	const bodyText = await response.text();
	const body = parseJson<ZillapiSearchResponse>(bodyText);

	if (!response.ok) {
		throw new Error(
			`Zillapi search failed (${response.status}): ${body?.error?.message ?? bodyText.slice(0, 500)}`,
		);
	}

	if (!Array.isArray(body?.data)) {
		throw new Error(`Zillapi search returned an unexpected response: ${bodyText.slice(0, 500)}`);
	}

	return body.data
		.map((item) => normalizeListing(item, search.area))
		.filter((listing): listing is Listing => listing !== null);
}

function normalizeListing(item: unknown, area: string | undefined): Listing | null {
	if (!isRecord(item)) return null;

	const zpid = asString(item.zpid ?? item.id);
	if (!zpid) return null;

	const hdpData = isRecord(item.hdpData) ? item.hdpData : undefined;
	const homeInfo = hdpData && isRecord(hdpData.homeInfo) ? hdpData.homeInfo : undefined;
	const latLong = isRecord(item.latLong) ? item.latLong : undefined;

	const address = asString(item.address) ?? asString(item.addressStreet) ?? `Zillow listing ${zpid}`;
	const detailUrl = absoluteZillowUrl(asString(item.detailUrl) ?? asString(item.hdpUrl));
	const latitude = asNumber(latLong?.latitude ?? homeInfo?.latitude);
	const longitude = asNumber(latLong?.longitude ?? homeInfo?.longitude);
	if (latitude === undefined || longitude === undefined) return null;

	return {
		zpid,
		area,
		address,
		price: asString(item.price),
		priceValue: asNumber(item.unformattedPrice ?? item.priceValue ?? homeInfo?.price),
		beds: asNumber(item.beds ?? homeInfo?.bedrooms),
		baths: asNumber(item.baths ?? homeInfo?.bathrooms),
		sqft: asNumber(item.area ?? item.livingArea ?? homeInfo?.livingArea),
		status: asString(item.statusType ?? homeInfo?.homeStatus),
		street: asString(item.addressStreet ?? homeInfo?.streetAddress),
		city: asString(item.addressCity ?? homeInfo?.city),
		state: asString(item.addressState ?? homeInfo?.state),
		zip: asString(item.addressZipcode ?? homeInfo?.zipcode),
		detailUrl,
		imageUrl: asString(item.imgSrc),
		latitude,
		longitude,
		zestimate: asNumber(item.zestimate ?? homeInfo?.zestimate),
		daysOnZillow: asNumber(homeInfo?.daysOnZillow),
		featured: asBoolean(item.isFeaturedListing),
		showcase: asBoolean(item.isShowcaseListing),
	};
}

function listingMarkdown(listing: Listing): string {
	const details = [
		listing.price,
		formatCount(listing.beds, "bed"),
		formatCount(listing.baths, "bath"),
		listing.sqft ? `${listing.sqft.toLocaleString()} sqft` : undefined,
	]
		.filter(Boolean)
		.join(" | ");

	const lines = listing.imageUrl ? [`![Listing image](${listing.imageUrl})`, "", `# ${listing.address}`] : [`# ${listing.address}`];
	if (details) lines.push("", details);
	if (listing.detailUrl) lines.push("", `[Open on Zillow](${listing.detailUrl})`);
	return lines.join("\n");
}

function listingTitle(listing: Listing): string {
	const facts = [
		bedBathLabel(listing.beds, listing.baths),
		listing.sqft ? `${listing.sqft}sqft` : undefined,
		titlePrice(listing),
	].filter(Boolean);

	return [listing.street ?? listing.address, facts.join(" / ")].filter(Boolean).join(" ");
}

function bedBathLabel(beds: number | undefined, baths: number | undefined): string | undefined {
	const parts = [];
	if (beds !== undefined) parts.push(`${formatCompactNumber(beds)}bd`);
	if (baths !== undefined) parts.push(`${formatCompactNumber(baths)}ba`);
	return parts.length > 0 ? parts.join("") : undefined;
}

function titlePrice(listing: Listing): string | undefined {
	if (listing.priceValue !== undefined) return `$${listing.priceValue}`;
	return listing.price?.replace(/\/mo$/, "");
}

function zillowSearches(): ZillowSearch[] {
	const configured = process.env.ZILLOW_SEARCHES;
	if (!configured) {
		throw new Error(
			'Missing ZILLOW_SEARCHES. Set it to a JSON array like `[{"area":"Downtown","url":"https://www.zillow.com/..."}]`.',
		);
	}

	const parsed = parseJson<unknown>(configured);
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("ZILLOW_SEARCHES must be a non-empty JSON array.");
	}

	return parsed.map((search, index) => {
		if (!isRecord(search)) {
			throw new Error(`ZILLOW_SEARCHES[${index}] must be an object with a Zillow search URL.`);
		}

		const url = asString(search.url)?.trim();
		if (!url) {
			throw new Error(`ZILLOW_SEARCHES[${index}].url is required.`);
		}
		validateZillowUrl(url, index);

		const area = asString(search.area)?.trim();
		return area ? { area, url } : { url };
	});
}

function validateZillowUrl(url: string, index: number) {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "zillow.com" && !parsed.hostname.endsWith(".zillow.com")) {
			throw new Error("not Zillow");
		}
	} catch {
		throw new Error(`ZILLOW_SEARCHES[${index}].url must be a full Zillow URL.`);
	}
}

function syncSchedule(): Schedule {
	const configured = process.env.ZILLOW_SYNC_SCHEDULE?.trim();
	if (!configured) return DEFAULT_SYNC_SCHEDULE;
	if (configured === "manual" || configured === "continuous") return configured;
	if (!/^\d+[mhd]$/.test(configured)) {
		throw new Error('ZILLOW_SYNC_SCHEDULE must look like "30m", "12h", "1d", "manual", or "continuous".');
	}
	return configured as Schedule;
}

function formatCompactNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function maxItems(): number {
	const raw = process.env.ZILLOW_MAX_ITEMS;
	if (!raw) return DEFAULT_MAX_ITEMS;

	const configured = Number(raw);
	if (!Number.isInteger(configured) || configured < 1 || configured > 50) {
		throw new Error("ZILLOW_MAX_ITEMS must be an integer from 1 to 50.");
	}
	return configured;
}

function formatCount(value: number | undefined, noun: string): string | undefined {
	if (value === undefined) return undefined;
	return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

function textValue(value: string | undefined) {
	return value ? Builder.richText(value) : [];
}

function urlValue(value: string | undefined) {
	return value ? Builder.url(value) : [];
}

function fileValue(value: string | undefined, name: string) {
	return value ? Builder.file(value, name) : [];
}

function numberValue(value: number | undefined) {
	return value === undefined ? [] : Builder.number(value);
}

function absoluteZillowUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value.startsWith("http://") || value.startsWith("https://")) return value;
	return `https://www.zillow.com${value.startsWith("/") ? "" : "/"}${value}`;
}

function parseJson<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

function asString(value: unknown): string | undefined {
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value.replace(/[$,]/g, ""));
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
