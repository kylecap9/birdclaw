import { Effect } from "effect";

export type PaginationStopReason =
	| "boundary"
	| "exhausted"
	| "item-limit"
	| "page-limit"
	| "repeated-cursor";

export interface PaginationPageContext<Page> {
	cursor?: string;
	fetched: number;
	page: Page;
	pageIndex: number;
	pageNumber: number;
	stopReason?: PaginationStopReason;
	done: boolean;
}

export interface PaginatedSyncResult<Page> {
	complete: boolean;
	fetched: number;
	nextCursor?: string;
	pages: Page[];
	stopReason: PaginationStopReason;
}

function normalizeCursor(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized || undefined;
}

export function collectPaginatedEffect<Page, ErrorType>({
	fetchPage,
	getItemCount,
	getNextCursor,
	initialCursor,
	maxItems,
	maxPages,
	onPage,
	pageDelayMs,
	shouldStop,
}: {
	fetchPage: (context: {
		cursor?: string;
		fetched: number;
		pageIndex: number;
	}) => Effect.Effect<Page, ErrorType>;
	getItemCount?: (page: Page) => number;
	getNextCursor: (page: Page) => string | null | undefined;
	initialCursor?: string;
	maxItems?: number;
	maxPages?: number;
	onPage?: (context: PaginationPageContext<Page>) => void;
	pageDelayMs?: number;
	shouldStop?: (context: Omit<PaginationPageContext<Page>, "done">) => boolean;
}): Effect.Effect<PaginatedSyncResult<Page>, ErrorType> {
	return Effect.gen(function* () {
		const pages: Page[] = [];
		const seenCursors = new Set<string>();
		let cursor = normalizeCursor(initialCursor);
		let fetched = 0;
		const pageLimit =
			maxPages === undefined ? Number.POSITIVE_INFINITY : Math.max(1, maxPages);
		const itemLimit =
			maxItems === undefined ? Number.POSITIVE_INFINITY : Math.max(1, maxItems);

		if (cursor) seenCursors.add(cursor);

		while (pages.length < pageLimit) {
			const pageIndex = pages.length;
			const page = yield* fetchPage({ cursor, fetched, pageIndex });
			pages.push(page);
			fetched += Math.max(0, getItemCount?.(page) ?? 0);
			const nextCursor = normalizeCursor(getNextCursor(page));
			const baseContext = {
				cursor,
				fetched,
				page,
				pageIndex,
				pageNumber: pageIndex + 1,
			};
			let stopReason: PaginationStopReason | undefined;

			if (!nextCursor) {
				stopReason = "exhausted";
			} else if (shouldStop?.(baseContext)) {
				stopReason = "boundary";
			} else if (fetched >= itemLimit) {
				stopReason = "item-limit";
			} else if (pages.length >= pageLimit) {
				stopReason = "page-limit";
			} else if (seenCursors.has(nextCursor)) {
				stopReason = "repeated-cursor";
			}

			if (stopReason) {
				onPage?.({ ...baseContext, done: true, stopReason });
				return {
					complete:
						stopReason === "exhausted" ||
						stopReason === "boundary" ||
						stopReason === "item-limit",
					fetched,
					...(nextCursor ? { nextCursor } : {}),
					pages,
					stopReason,
				};
			}

			cursor = nextCursor;
			seenCursors.add(nextCursor!);
			onPage?.({ ...baseContext, done: false });
			if (typeof pageDelayMs === "number" && pageDelayMs > 0) {
				yield* Effect.sleep(pageDelayMs);
			}
		}

		return {
			complete: false,
			fetched,
			...(cursor ? { nextCursor: cursor } : {}),
			pages,
			stopReason: "page-limit",
		};
	});
}
