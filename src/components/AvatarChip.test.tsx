import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarChip } from "./AvatarChip";

afterEach(() => {
	cleanup();
});

describe("AvatarChip", () => {
	it("renders initials, hue, and large variant", () => {
		render(<AvatarChip hue={210} name="Sam Altman" size="large" />);

		const chip = screen.getByText("SA");
		expect(chip).toHaveClass("avatar-chip-large");
		expect(chip).toHaveStyle({ backgroundColor: "rgb(36, 128, 219)" });
	});

	it("renders cached avatar image when profile metadata exists", () => {
		render(
			<AvatarChip
				avatarUrl="https://pbs.twimg.com/profile_images/123/avatar.jpg"
				hue={210}
				name="Sam Altman"
				profileId="profile_sam"
			/>,
		);

		const image = screen.getByRole("img", { name: "Sam Altman" });
		expect(image).toHaveAttribute(
			"src",
			expect.stringContaining("/api/avatar?profileId=profile_sam&v="),
		);
	});

	it("falls back to initials when avatar loading fails", () => {
		render(
			<AvatarChip
				avatarUrl="https://pbs.twimg.com/profile_images/123/avatar.jpg"
				hue={210}
				name="Sam Altman"
				profileId="profile_sam"
			/>,
		);

		const image = screen.getByRole("img", { name: "Sam Altman" });
		fireEvent.error(image);

		expect(screen.getByText("SA")).toBeInTheDocument();
	});
});
