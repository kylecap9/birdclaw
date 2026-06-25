// @vitest-environment node
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestHome,
	insertTestAccount,
	type TestHome,
} from "../test/test-home";

// ai-sync shells out to bird `search` (a LIVE X call); mock just that so the test never touches X
// and we can assert the roster terms + per-search limit.
const searchMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/bird", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/bird")>();
	return { ...actual, searchTweetsViaBird: searchMock };
});

import { readAiFeed, syncAiFeed } from "./register-cc-ai";

describe("AI feed (ai-sync / ai-feed)", () => {
	let home: TestHome;
	beforeEach(() => {
		home = createTestHome();
		searchMock.mockReset();
	});
	afterEach(() => {
		home.cleanup();
	});

	it("pulls roster accounts + queries into the 'ai' lane and reads them back", async () => {
		insertTestAccount(home.db);
		let n = 0;
		searchMock.mockImplementation((term: string) => {
			n += 1;
			return Promise.resolve({
				data: [
					{
						id: `ai_${n}`,
						author_id: "u1",
						text: `cutting-edge AI re: ${term}`,
						created_at: "2026-06-25T10:00:00Z",
						public_metrics: { like_count: 3 },
					},
				],
				includes: {
					users: [{ id: "u1", username: "karpathy", name: "Andrej Karpathy" }],
				},
			});
		});

		const res = await syncAiFeed({ per: 5, delayMs: 0 });

		expect(res.ok).toBe(true);
		expect(res.synced).toBeGreaterThan(0);
		// roster handles are queried as from:<handle>
		expect(
			searchMock.mock.calls.some((c) => String(c[0]).startsWith("from:")),
		).toBe(true);
		expect(searchMock).toHaveBeenCalledWith("from:karpathy", { maxResults: 5 });

		// the AI content is readable via the local ai-feed
		expect(readAiFeed(50).length).toBeGreaterThan(0);
		// EDGE-TAGGED "ai", never "home" — so the AI feed can't pollute Home/For You
		const aiEdges = home.db
			.prepare("select count(*) as n from tweet_account_edges where kind='ai'")
			.get() as { n: number };
		const homeEdges = home.db
			.prepare(
				"select count(*) as n from tweet_account_edges where kind='home'",
			)
			.get() as { n: number };
		expect(aiEdges.n).toBeGreaterThan(0);
		expect(homeEdges.n).toBe(0);
	});

	it("honours a custom roster file (only the listed handles/queries are pulled)", async () => {
		insertTestAccount(home.db);
		searchMock.mockResolvedValue({ data: [], includes: { users: [] } });
		const rosterPath = `${home.makeTempDir()}/roster.json`;
		writeFileSync(
			rosterPath,
			JSON.stringify({ handles: ["onlyone"], queries: ["robotics"] }),
		);

		await syncAiFeed({ roster: rosterPath, per: 3, delayMs: 0 });

		expect(searchMock).toHaveBeenCalledTimes(2);
		expect(searchMock).toHaveBeenCalledWith("from:onlyone", { maxResults: 3 });
		expect(searchMock).toHaveBeenCalledWith("robotics", { maxResults: 3 });
	});
});
