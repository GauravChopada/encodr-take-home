import { expect, test, type Page } from "@playwright/test";

const FAIL_URL = "https://cdn.example.com/videos/corrupt.mp4";

async function signIn(page: Page, password = "password123") {
  await page.goto("/signin");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Creates a job (unique title, so parallel tests never collide) and opens its detail page. */
async function createAndOpenJob(page: Page, sourceUrl: string, label: string) {
  const title = `${label} ${Date.now()}`;
  await page.getByLabel("Source URL").fill(sourceUrl);
  await page.getByLabel("Title (optional)").fill(title);
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return title;
}

test("redirects to sign-in when signed out, and rejects a wrong password", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/signin$/);

  await signIn(page, "not-the-password");
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
});

test("happy path: create a job, watch it encode live, see the results and the updated list", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/jobs$/);

  // Client-side validation runs before anything is sent.
  await page.getByLabel("Source URL").fill("https://example.com/notes.txt");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText(/must end in a media extension/)).toBeVisible();

  const title = await createAndOpenJob(page, "https://cdn.example.com/videos/sample.mp4", "Happy path");
  await page.getByRole("button", { name: "Start encode" }).click();

  // Live progress: the stream drives the stage, percentage and log.
  const log = page.getByRole("log", { name: "Encode log" });
  await expect(log).toContainText("Entering DOWNLOADING");
  await expect(page.getByRole("progressbar")).toBeVisible();

  // Terminal state: results come from server data.
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1920x1080" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "854x480" })).toBeVisible();
  await expect(page.getByText("Audio track 2 has no language tag")).toBeVisible();

  // The jobs list reflects the terminal status.
  await page.getByRole("link", { name: /All jobs/ }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("COMPLETED");
});

test("failure path: the corrupt source fails partway, shows the error, and Retry starts a new run", async ({ page }) => {
  await signIn(page);
  await createAndOpenJob(page, FAIL_URL, "Failure path");
  await page.getByRole("button", { name: "Start encode" }).click();

  // (Next's route announcer is also role="alert", so scope to the failure panel.)
  const failure = page.getByRole("alert").filter({ hasText: "Encode failed" });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("Source stream is corrupt: invalid moov atom");
  // It failed partway, never reaching the packaging stage.
  await expect(page.getByRole("log", { name: "Encode log" })).not.toContainText("Entering PACKAGING");

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Encode failed")).toBeHidden();
  await expect(page.getByRole("log", { name: "Encode log" })).toContainText("Entering QUEUED");
});
