import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runEffectPromise } from "./effect-runtime";
import { collectPaginatedEffect } from "./paginated-sync";

describe("collectPaginatedEffect", () => {
	it("collects pages and reports exhaustion", async () => {
		const pages = [
			{ items: ["one"], next: "page-2" },
			{ items: ["two"], next: undefined },
		];
		const result = await runEffectPromise(
			collectPaginatedEffect({
				fetchPage: ({ pageIndex }) => Effect.succeed(pages[pageIndex]),
				getItemCount: (page) => page.items.length,
				getNextCursor: (page) => page.next,
			}),
		);

		expect(result).toMatchObject({
			complete: true,
			fetched: 2,
			stopReason: "exhausted",
		});
		expect(result.pages).toEqual(pages);
	});

	it("stops at caps and exposes the resumable cursor", async () => {
		const onPage = vi.fn();
		const result = await runEffectPromise(
			collectPaginatedEffect({
				fetchPage: ({ cursor }) =>
					Effect.succeed({
						items: [cursor ?? "first"],
						next: cursor ? "page-3" : "page-2",
					}),
				getItemCount: (page) => page.items.length,
				getNextCursor: (page) => page.next,
				maxPages: 1,
				onPage,
			}),
		);

		expect(result).toMatchObject({
			complete: false,
			nextCursor: "page-2",
			stopReason: "page-limit",
		});
		expect(onPage).toHaveBeenCalledWith(
			expect.objectContaining({ done: true, stopReason: "page-limit" }),
		);
	});

	it("breaks repeated cursor loops", async () => {
		const result = await runEffectPromise(
			collectPaginatedEffect({
				fetchPage: ({ cursor }) =>
					Effect.succeed({ items: [cursor ?? "first"], next: "same" }),
				getNextCursor: (page) => page.next,
			}),
		);

		expect(result).toMatchObject({
			complete: false,
			nextCursor: "same",
			stopReason: "repeated-cursor",
		});
		expect(result.pages).toHaveLength(2);
	});
});
