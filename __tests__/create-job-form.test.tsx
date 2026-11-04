import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateJobForm } from "@/components/create-job-form";

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateJobForm />
    </QueryClientProvider>,
  );
}

const urlInput = () => screen.getByLabelText("Source URL");
const submit = () => userEvent.click(screen.getByRole("button", { name: "Create job" }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CreateJobForm", () => {
  it("asks for a source URL before sending anything", async () => {
    renderForm();
    await submit();
    expect(await screen.findByText("Source URL is required")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the schema's message for a malformed URL without calling the server", async () => {
    renderForm();
    await userEvent.type(urlInput(), "nope");
    await submit();
    expect(await screen.findByText(/Enter a full URL/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts a server-side 422 on the Source URL field", async () => {
    fetchMock.mockResolvedValue(
      json(422, { detail: "Validation failed", fieldErrors: { sourceUrl: ["Host is not allowed"] } }),
    );
    renderForm();
    await userEvent.type(urlInput(), "https://cdn.example.com/a.mp4");
    await submit();
    expect(await screen.findByText("Host is not allowed")).toBeInTheDocument();
    expect(urlInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("posts the trimmed values and clears the form on success", async () => {
    fetchMock.mockResolvedValue(json(201, { id: "j_1" }));
    renderForm();
    await userEvent.type(urlInput(), "  https://cdn.example.com/a.mp4 ");
    await userEvent.type(screen.getByLabelText("Title (optional)"), "My clip");
    await submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/jobs");
    expect(JSON.parse(String(init?.body))).toEqual({
      sourceUrl: "https://cdn.example.com/a.mp4",
      title: "My clip",
    });
    await waitFor(() => expect(urlInput()).toHaveValue(""));
  });
});
