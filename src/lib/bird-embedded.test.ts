// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestHome,
	insertTestAccount,
	type TestHome,
} from "../test/test-home";
import { __test__ as birdTest } from "./bird";
import { ingestTweetPayload } from "./tweet-repository";

describe("inline quoted-tweet ingestion", () => {
	let home: TestHome;
	beforeEach(() => {
		home = createTestHome();
	});
	afterEach(() => {
		home.cleanup();
	});

	it("captures an inline quoted tweet and ingests it EDGE-LESS (resolves embeds, no feed pollution)", () => {
		const account = insertTestAccount(home.db);
		const payload = birdTest.normalizeBirdTweets([
			{
				id: "main_1",
				text: "this is huge https://t.co/x",
				createdAt: "2026-06-25T10:00:00.000Z",
				authorId: "10",
				author: { username: "swyx", name: "swyx" },
				quotedStatusId: "quoted_1",
				quotedTweet: {
					id: "quoted_1",
					text: "the original tweet",
					createdAt: "2026-06-25T09:00:00.000Z",
					authorId: "20",
					author: { username: "OpenAI", name: "OpenAI" },
				},
			},
		]);
		// the inline quote is captured for edge-less ingestion
		expect((payload.embedded ?? []).map((t) => t.id)).toEqual(["quoted_1"]);

		ingestTweetPayload(home.db, {
			accountId: account.id,
			payload,
			source: "bird",
			edgeKind: "ai",
		});

		const ids = (
			home.db.prepare("select id from tweets order by id").all() as Array<{
				id: string;
			}>
		).map((r) => r.id);
		expect(ids).toContain("main_1");
		expect(ids).toContain("quoted_1");

		// main tweet is in the AI lane; the quoted tweet carries NO edge (won't show as its own item)
		const mainEdge = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where tweet_id='main_1' and kind='ai'",
			)
			.get() as { n: number };
		const quotedEdge = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where tweet_id='quoted_1'",
			)
			.get() as { n: number };
		expect(mainEdge.n).toBe(1);
		expect(quotedEdge.n).toBe(0);

		// the embed link is recorded so listTimelineItems can resolve the quoted card
		const main = home.db
			.prepare("select quoted_tweet_id from tweets where id='main_1'")
			.get() as { quoted_tweet_id: string };
		expect(main.quoted_tweet_id).toBe("quoted_1");
	});
});
