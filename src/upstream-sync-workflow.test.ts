// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
	"../.github/workflows/upstream-sync.yml",
	import.meta.url,
);
const workflow = existsSync(workflowUrl)
	? readFileSync(workflowUrl, "utf8")
	: "";

describe("upstream release automation", () => {
	it("checks on a schedule and supports a manual run", () => {
		expect(workflow).toContain("schedule:");
		expect(workflow).toContain("workflow_dispatch:");
	});

	it("tracks the latest stable upstream release instead of arbitrary main", () => {
		expect(workflow).toContain("steipete/birdclaw/releases/latest");
		expect(workflow).toContain("tag_name");
		expect(workflow).not.toMatch(/merge\s+upstream\/main/);
	});

	it("creates an auditable candidate branch without force-updating main", () => {
		expect(workflow).toContain("automation/upstream-");
		expect(workflow).toContain("pull-requests: write");
		expect(workflow).not.toContain("--force");
		expect(workflow).not.toMatch(/push\s+origin\s+(HEAD:)?main/);
	});

	it("fails closed on conflicts and records the blocked update", () => {
		expect(workflow).toContain("git merge --abort");
		expect(workflow).toContain("issues: write");
		expect(workflow).toContain("upstream-sync-blocked");
	});

	it("runs the complete repository gate before opening an update PR", () => {
		expect(workflow).toContain("pnpm check");
		expect(workflow).toContain("pnpm coverage");
		expect(workflow).toContain("pnpm build");
		expect(workflow).toContain("pnpm e2e");
	});

	it("does not expose repository or production secrets", () => {
		expect(workflow).not.toContain("secrets.");
		expect(workflow).toContain('BIRDCLAW_DISABLE_LIVE_WRITES: "1"');
	});
});
