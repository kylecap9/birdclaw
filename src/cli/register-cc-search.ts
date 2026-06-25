// Command Center live X search — `cc-search <query>` runs ONE live `bird search` (the free cookie
// transport, never the paid xurl path), caches the hits into the "search" lane (edge-tagged so they
// never pollute Home/For You), and prints them in the display shape (media + embedded quotes). The
// gentlest possible call: a single page, small limit. The CC adapter rate-limits + audits each call.
// Isolated file (keeps upstream merges from steipete/birdclaw conflict-free); not upstreamed.
import { searchTweetsViaBird } from "#/lib/bird";
import { getNativeDb } from "#/lib/db";
import { resolveLiveSyncAccount } from "#/lib/live-sync-engine";
import { getTweetsByIds } from "#/lib/timeline-read-model";
import { ingestTweetPayload } from "#/lib/tweet-repository";
import type { EmbeddedTweet } from "#/lib/types";
import type { CliCommandContext } from "./command-context";

export interface CcSearchResponse {
	ok: true;
	query: string;
	count: number;
	items: EmbeddedTweet[];
}

/**
 * Live X search via bird (a single page), cached into the "search" lane and returned in the display
 * shape. Result ids are taken from the payload (NOT the ingest return) so already-cached hits still
 * show — `ingestTweetPayload` only reports newly-stored ids, which would otherwise drop repeats.
 */
export async function searchLive(
	query: string,
	opts: { limit?: number } = {},
): Promise<CcSearchResponse> {
	const limit = opts.limit ?? 30;
	const db = getNativeDb();
	const account = resolveLiveSyncAccount(db);
	const payload = await searchTweetsViaBird(query, { maxResults: limit });
	// Cache the hits into the dedicated "search" lane — edge-tagged, never a feed (home/like/bookmark) edge.
	ingestTweetPayload(db, {
		accountId: account.accountId,
		payload,
		source: "bird",
		edgeKind: "search",
	});
	const ids = (payload.data ?? []).map((d) => String(d.id)).slice(0, limit);
	return { ok: true, query, count: ids.length, items: getTweetsByIds(ids) };
}

export function registerCcSearchCommands({
	program,
	print,
	asJson,
}: CliCommandContext) {
	program
		.command("cc-search <query>")
		.description(
			"Live X search via bird (1 page), cache into the 'search' lane, print results",
		)
		.option("--limit <n>", "Result limit", "30")
		.action(async (query: string, options: { limit: string }) => {
			print(
				await searchLive(query, { limit: Number(options.limit) }),
				asJson(),
			);
		});
}
