// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestHome,
	insertTestAccount,
	insertTestProfile,
	insertTestTweet,
	type TestHome,
} from "../test/test-home";

// fetch-thread shells out to bird (a LIVE X call); mock just that one function so the test never
// touches X, and so we can assert it's invoked exactly once with no pagination (one gentle request).
const listThreadViaBirdMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/bird", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/bird")>();
	return { ...actual, listThreadViaBird: listThreadViaBirdMock };
});

import { buildThreadResponse, fetchThreadLive } from "./register-cc-thread";

// The `show thread <id>` command is a LOCAL read for the Command Center panel: it resolves a
// tweet's conversation (ancestor chain + reply descendants) straight from SQLite with zero
// live X calls. These lock the two behaviours the CC panel depends on.
describe("buildThreadResponse (show thread, local-only)", () => {
	let home: TestHome;
	beforeEach(() => {
		home = createTestHome();
	});
	afterEach(() => {
		home.cleanup();
	});

	it("returns ancestors + anchor + replies for a cached conversation", () => {
		const db = home.db;
		insertTestProfile(db);
		insertTestTweet(db, {
			id: "conv_root",
			text: "root of the thread",
			createdAt: "2026-03-10T10:00:00.000Z",
		});
		insertTestTweet(db, {
			id: "conv_anchor",
			text: "the clicked tweet",
			createdAt: "2026-03-10T10:01:00.000Z",
			replyToId: "conv_root",
		});
		insertTestTweet(db, {
			id: "conv_child",
			text: "a reply (comment) under the clicked tweet",
			createdAt: "2026-03-10T10:02:00.000Z",
			replyToId: "conv_anchor",
		});

		const result = buildThreadResponse("conv_anchor");

		expect(result.ok).toBe(true);
		expect(result.anchorId).toBe("conv_anchor");
		// ancestor (root), the anchor, and its reply/comment — proves the reply_to_id descendant walk.
		expect(result.items.map((tweet) => tweet.id)).toEqual([
			"conv_root",
			"conv_anchor",
			"conv_child",
		]);
	});

	it("returns an empty conversation (not an error) for an uncached tweet id", () => {
		insertTestProfile(home.db);

		// A tweet whose thread was never synced is a cache MISS, not a failure: the command must
		// degrade to an empty conversation so the panel shows "no cached replies" + a live-fetch
		// affordance, instead of the adapter turning a non-zero exit into a 502.
		const result = buildThreadResponse("never_synced");

		expect(result.ok).toBe(true);
		expect(result.anchorId).toBe("never_synced");
		expect(result.items).toEqual([]);
	});
});

describe("fetchThreadLive (fetch-thread — one live bird request, edge-less)", () => {
	let home: TestHome;
	beforeEach(() => {
		home = createTestHome();
		listThreadViaBirdMock.mockReset();
	});
	afterEach(() => {
		home.cleanup();
	});

	it("fetches one thread via bird, stores replies edge-less, returns the fresh conversation", async () => {
		insertTestAccount(home.db);
		listThreadViaBirdMock.mockResolvedValue({
			data: [
				{
					id: "anchor1",
					author_id: "u1",
					text: "the clicked tweet",
					created_at: "2026-06-20T10:00:00Z",
					public_metrics: { like_count: 2 },
				},
				{
					id: "reply1",
					author_id: "u2",
					text: "a freshly fetched reply",
					created_at: "2026-06-20T10:05:00Z",
					referenced_tweets: [{ type: "replied_to", id: "anchor1" }],
					public_metrics: { like_count: 0 },
				},
			],
			includes: {
				users: [
					{ id: "u1", username: "kyle", name: "Kyle" },
					{ id: "u2", username: "ada", name: "Ada" },
				],
			},
		});

		const result = await fetchThreadLive("anchor1");

		// ONE gentle request: invoked exactly once, with just the tweetId — no --all / --max-pages.
		expect(listThreadViaBirdMock).toHaveBeenCalledTimes(1);
		expect(listThreadViaBirdMock).toHaveBeenCalledWith({ tweetId: "anchor1" });
		// the live reply is now part of the local conversation
		expect(result.anchorId).toBe("anchor1");
		expect(result.items.map((tweet) => tweet.id)).toContain("reply1");
		expect(result.fetched).toBe(2);
		// EDGE-LESS: the fetched tweets carry no feed edge, so loaded replies can never pollute
		// the Home / For You feed (search tweets --resource home only returns home-edged rows).
		const edges = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where tweet_id in ('anchor1','reply1')",
			)
			.get() as { n: number };
		expect(edges.n).toBe(0);
	});
});
