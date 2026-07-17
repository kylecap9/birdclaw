// Command Center read commands (`show thread`) — kept in a dedicated file so upstream merges
// from steipete/birdclaw don't conflict with these local fork additions. Registered from
// src/cli.ts. Read-only: resolves a tweet's conversation straight from the local SQLite store
// with ZERO live X calls (the live fetch lives in the separate `sync thread` command).
import { listThreadViaBird } from "#/lib/bird";
import { getNativeDb } from "#/lib/db";
import { resolveLiveSyncAccount } from "#/lib/live-sync-engine";
import { getTweetConversation } from "#/lib/timeline-read-model";
import { ingestTweetPayload } from "#/lib/tweet-repository";
import type { EmbeddedTweet } from "#/lib/types";
import type { CliCommandContext } from "./command-context";

export interface ThreadResponse {
	ok: true;
	anchorId: string;
	items: EmbeddedTweet[];
}

export interface LiveThreadResponse extends ThreadResponse {
	fetched: number;
}

/**
 * Resolve a tweet's local conversation (ancestor chain + reply descendants) for the CC panel.
 *
 * A cache miss (the tweet's thread was never synced) is NOT an error — it returns an empty
 * conversation so the panel renders an honest "no cached replies" state and offers an explicit
 * live fetch, rather than the adapter turning a non-zero exit into a 502. The shape mirrors
 * birdclaw's own `/api/conversation` response so the CC adapter parses both identically.
 */
export function buildThreadResponse(tweetId: string): ThreadResponse {
	const conversation = getTweetConversation(tweetId);
	return conversation
		? { ok: true, anchorId: conversation.anchorId, items: conversation.items }
		: { ok: true, anchorId: tweetId, items: [] };
}

/**
 * Live-fetch ONE tweet's conversation through bird — a single `bird thread <id>` request with NO
 * pagination (the gentlest possible call, ~equivalent to opening that tweet in a browser), stored
 * EDGE-LESS (no home/like/bookmark edge) so the loaded replies are readable as conversation context
 * but never leak into a feed lane. Returns the now-fresh local conversation. This is the only path
 * that spends a live X read, and only when the user explicitly asks for it.
 */
export async function fetchThreadLive(
	tweetId: string,
): Promise<LiveThreadResponse> {
	const db = getNativeDb();
	const account = resolveLiveSyncAccount(db);
	const payload = await listThreadViaBird({ tweetId });
	const ids = ingestTweetPayload(db, {
		accountId: account.accountId,
		payload,
		source: "bird",
		markRepliesAsReplied: true,
		// edge-less by design: no edgeKind / collectionKind, so fetched replies never enter a feed.
	});
	return { ...buildThreadResponse(tweetId), fetched: ids.length };
}

export function registerCcThreadCommands({
	program,
	print,
	asJson,
}: CliCommandContext) {
	const show = program
		.command("show")
		.description("Read a single local record from the store (no live X calls)");

	show
		.command("thread <tweetId>")
		.description(
			"Print a tweet's local conversation (ancestors + replies) — reads SQLite, never X",
		)
		.action((tweetId: string) => {
			print(buildThreadResponse(tweetId), asJson());
		});

	program
		.command("fetch-thread <tweetId>")
		.description(
			"Live-fetch one tweet's conversation via bird (1 request), store it edge-less, print the thread",
		)
		.action(async (tweetId: string) => {
			print(await fetchThreadLive(tweetId), asJson());
		});
}
