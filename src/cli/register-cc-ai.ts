// Command Center "AI feed" — a curated stream of cutting-edge AI content, independent of the
// account's own follows/algorithm. `ai-sync` live-pulls tweets from a roster of top AI accounts
// (via `from:<handle>` searches) plus topic searches and tags them with an "ai" edge, so they form
// their own lane and NEVER pollute Home/For You. `ai-feed` reads that lane locally (zero live X).
// Isolated file (keeps upstream merges conflict-free); not upstreamed.
import { readFileSync } from "node:fs";
import { searchTweetsViaBird } from "#/lib/bird";
import { getNativeDb } from "#/lib/db";
import { resolveLiveSyncAccount } from "#/lib/live-sync-engine";
import { listTimelineItems } from "#/lib/timeline-read-model";
import type { TimelineItem } from "#/lib/types";
import { ingestTweetPayload } from "#/lib/tweet-repository";
import type { CliCommandContext } from "./command-context";

// Strong default roster — leading AI researchers, labs, and builders. Editable via --roster.
// Roster-curated by design: the accounts ARE the quality filter. Broad topic searches are left
// empty by default because on X they're dominated by crypto/engagement-bait spam; add high-signal
// queries (e.g. with min_faves:) to the roster file if you want extra breadth.
const DEFAULT_HANDLES = [
	"karpathy",
	"sama",
	"gdb",
	"OpenAI",
	"AnthropicAI",
	"GoogleDeepMind",
	"ylecun",
	"drjimfan",
	"swyx",
	"simonw",
	"emollick",
	"_akhaliq",
	"rowancheung",
	"TheTuringPost",
	"huggingface",
	"MistralAI",
	"AndrewYNg",
	"hardmaru",
	"_jasonwei",
	"alexalbert__",
	"demishassabis",
	"JeffDean",
	"ClementDelangue",
	"AIatMeta",
	"OpenAIDevs",
	"goodside",
];
// High-signal topic searches for breadth beyond the roster — catch big AI news from anyone.
// Tuned to resist X's crypto/engagement-bait spam: a high min_faves: floor, English, no replies
// or native-RTs, and explicit crypto exclusions. (Verified live before adding.)
const DEFAULT_QUERIES: string[] = [
	'(LLM OR "language model" OR "frontier model") min_faves:800 -filter:replies -filter:nativeretweets lang:en -crypto -$ -airdrop -token',
	'("AI model" OR "open weights" OR "open-source AI" OR "model release") min_faves:1000 -filter:replies -filter:nativeretweets lang:en -crypto -$ -airdrop -token',
];

interface Roster {
	handles: string[];
	queries: string[];
}

function loadRoster(path?: string): Roster {
	if (path) {
		try {
			const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Roster>;
			return {
				handles: Array.isArray(raw.handles)
					? raw.handles.map(String)
					: DEFAULT_HANDLES,
				queries: Array.isArray(raw.queries)
					? raw.queries.map(String)
					: DEFAULT_QUERIES,
			};
		} catch {
			// Missing/invalid roster file -> fall back to the baked-in defaults.
		}
	}
	return { handles: DEFAULT_HANDLES, queries: DEFAULT_QUERIES };
}

// Round-robin by author so no single chatty account dominates the top: take each author's newest
// post (authors ordered by recency of their newest), then their next, and so on. Preserves
// per-author recency order; keeps the feed fresh AND diverse.
export function interleaveByAuthor<
	T extends { author?: { handle?: string; id?: string } },
>(items: T[]): T[] {
	const groups = new Map<string, T[]>();
	const order: string[] = [];
	for (const item of items) {
		const key = item.author?.handle || item.author?.id || "?";
		let group = groups.get(key);
		if (!group) {
			group = [];
			groups.set(key, group);
			order.push(key);
		}
		group.push(item);
	}
	const out: T[] = [];
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const key of order) {
			const group = groups.get(key);
			if (group && group.length > 0) {
				out.push(group.shift() as T);
				progressed = true;
			}
		}
	}
	return out;
}

export function readAiFeed(limit = 50): TimelineItem[] {
	// Pull a larger recency-ordered pool, then interleave by author and take the top `limit`.
	const pool = listTimelineItems({
		resource: "ai",
		limit: Math.max(limit * 4, 80),
	});
	return interleaveByAuthor(pool).slice(0, limit);
}

export interface AiSyncResult {
	ok: true;
	synced: number;
	terms: number;
	errors: string[];
}

/**
 * Live-pull curated AI content into the "ai" lane. One `bird search` per roster account
 * (`from:<handle>`) + per topic query, each ingested EDGE-tagged "ai" (never "home"), gently paced.
 */
export async function syncAiFeed(
	opts: { roster?: string; per?: number; delayMs?: number } = {},
): Promise<AiSyncResult> {
	const db = getNativeDb();
	const account = resolveLiveSyncAccount(db);
	const { handles, queries } = loadRoster(opts.roster);
	const per = opts.per ?? 15;
	const delayMs = opts.delayMs ?? 800;
	// Exclude replies: a roster account's "@x thanks!" replies are clutter; we want their original
	// posts/threads (the substantive AI content). Retweets are kept — AI accounts' RTs are signal.
	const terms = [
		...handles.map((h) => `from:${h.replace(/^@/, "")} -filter:replies`),
		...queries,
	];
	let synced = 0;
	const errors: string[] = [];
	for (const [index, term] of terms.entries()) {
		try {
			const payload = await searchTweetsViaBird(term, { maxResults: per });
			const ids = ingestTweetPayload(db, {
				accountId: account.accountId,
				payload,
				source: "bird",
				edgeKind: "ai",
			});
			synced += ids.length;
		} catch (error) {
			errors.push(
				`${term}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (delayMs > 0 && index < terms.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
	return { ok: true, synced, terms: terms.length, errors };
}

export function registerCcAiCommands({
	program,
	print,
	asJson,
}: CliCommandContext) {
	program
		.command("ai-feed")
		.description(
			"Print the curated AI feed (local read of the 'ai' lane — no live X calls)",
		)
		.option("--limit <n>", "Result limit", "50")
		.action((options: { limit: string }) => {
			print({ ok: true, items: readAiFeed(Number(options.limit)) }, asJson());
		});

	program
		.command("ai-sync")
		.description(
			"Live-pull curated AI content (roster accounts + topic searches) into the 'ai' lane",
		)
		.option(
			"--roster <path>",
			"JSON file {handles:[],queries:[]} (defaults baked in)",
		)
		.option("--per <n>", "Tweets per account/query", "15")
		.option("--delay-ms <n>", "Delay between searches (gentle pacing)", "800")
		.action(
			async (options: { roster?: string; per: string; delayMs: string }) => {
				const result = await syncAiFeed({
					roster: options.roster,
					per: Number(options.per),
					delayMs: Number(options.delayMs),
				});
				print(result, asJson());
			},
		);
}
