// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestHome,
	insertTestAccount,
	type TestHome,
} from "../test/test-home";

// cc-search shells out to bird `search` (a LIVE X call); mock just that so the test never touches X.
// We exercise the REAL ingest + read-back so the cached "search" lane + display shape are covered.
const searchMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/bird", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/bird")>();
	return { ...actual, searchTweetsViaBird: searchMock };
});

import { searchLive } from "./register-cc-search";

describe("live X search (cc-search)", () => {
	let home: TestHome;
	beforeEach(() => {
		home = createTestHome();
		searchMock.mockReset();
	});
	afterEach(() => {
		home.cleanup();
	});

	it("runs a live bird search, caches into the 'search' lane, and returns the hits", async () => {
		insertTestAccount(home.db);
		searchMock.mockResolvedValue({
			data: [
				{
					id: "s1",
					author_id: "u1",
					text: "agentic eval harness drops",
					created_at: "2026-06-25T10:00:00Z",
					public_metrics: { like_count: 5 },
				},
				{
					id: "s2",
					author_id: "u1",
					text: "more on agents",
					created_at: "2026-06-25T10:01:00Z",
					public_metrics: { like_count: 9 },
				},
			],
			includes: {
				users: [{ id: "u1", username: "karpathy", name: "Andrej Karpathy" }],
			},
		});

		const res = await searchLive("agents", { limit: 10 });

		// one live request, with the small single-page limit
		expect(searchMock).toHaveBeenCalledWith("agents", { maxResults: 10 });
		expect(res.ok).toBe(true);
		expect(res.query).toBe("agents");
		expect(res.items.map((t) => t.id).sort()).toEqual(["s1", "s2"]);
		expect(res.items[0]?.author?.handle).toBe("karpathy");

		// hits land in the "search" lane only — never a feed (home) edge
		const searchEdges = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where kind='search'",
			)
			.get() as { n: number };
		const homeEdges = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where kind='home'",
			)
			.get() as { n: number };
		expect(searchEdges.n).toBeGreaterThan(0);
		expect(homeEdges.n).toBe(0);
	});

	it("returns an empty result set when X has no matches", async () => {
		insertTestAccount(home.db);
		searchMock.mockResolvedValue({ data: [], includes: { users: [] } });
		const res = await searchLive("nothingmatchesthis", { limit: 10 });
		expect(res.ok).toBe(true);
		expect(res.count).toBe(0);
		expect(res.items).toEqual([]);
	});
});
