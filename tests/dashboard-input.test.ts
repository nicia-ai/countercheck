import { describe, expect, it } from "vitest";
import {
  prepareCheckInput,
  modelAvailability,
  renderAccessRequests,
  renderAdminInvitations,
  renderUsageRollups,
  renderAuthForm,
} from "../dashboard/client.js";
import { checkRequestSchema } from "../src/contracts/index.js";
import { DEFAULT_MODEL } from "../src/contracts/models.js";
import { SUPPORTED_MODELS } from "../src/contracts/models.js";
import type { Model } from "../src/contracts/models.js";
import { dashboardPage } from "../src/dashboard/page.js";

describe("dashboard request boundaries", () => {
  it("compares the first statement with subsequent lines and preserves physical line IDs and text", () => {
    const payload = prepareCheckInput("\r\n  original claim  \r\n\r\n first \r\nsecond\n");
    expect(checkRequestSchema.parse(payload)).toEqual(payload);
    expect(payload.claim).toEqual({ id: "line_2", text: "  original claim  " });
    expect(payload.against).toEqual([
      { id: "line_4", text: " first " },
      { id: "line_5", text: "second" },
    ]);
  });
  it("counts multibyte text at the API byte boundary without shortening it", () => {
    const text = "é".repeat(1024);
    const payload = prepareCheckInput(`claim\n${text}`);
    expect(checkRequestSchema.safeParse(payload).success).toBe(true);
    expect(payload.against[0]!.text).toBe(text);
    expect(() => prepareCheckInput(`claim\n${text}é`)).toThrow("Line 2 exceeds its byte limit");
    expect(() => prepareCheckInput(`${"é".repeat(2049)}\nother`)).toThrow(
      "Line 1 exceeds its byte limit",
    );
  });
  it("defaults to Jev and only includes one of the supported models", () => {
    const defaultPayload = prepareCheckInput("claim\ncomparison");
    expect(defaultPayload.model).toBe(DEFAULT_MODEL);
    expect(defaultPayload.profile).toBe("balanced-v1");
    for (const model of SUPPORTED_MODELS) {
      const payload = prepareCheckInput("claim\ncomparison", model.id);
      expect(payload.model).toBe(model.id);
      expect(checkRequestSchema.parse(payload).model).toBe(model.id);
    }
    expect(() => prepareCheckInput("claim\ncomparison", "other-model" as Model)).toThrow(
      "supported models",
    );
    const page = dashboardPage();
    expect(page).toContain('label for="check-model">Model</label>');
    for (const model of SUPPORTED_MODELS) expect(page).toContain(`<option value="${model.id}"`);
    expect(page).toContain(`<option value="${DEFAULT_MODEL}" selected>`);
    expect(page).toContain("All evaluation models share the same quota.");
    expect(page).toContain('id="retry-models"');
    expect(page).toContain(
      'id="run-check" class="button primary" type="submit" data-requires-active disabled',
    );
  });
  it("maps the deployment catalog to all supported model availability flags", () => {
    const configured = new Set(
      SUPPORTED_MODELS.filter((_, index) => index % 2 === 0).map((model) => model.id),
    );
    const options = modelAvailability(
      SUPPORTED_MODELS.map((model) => ({ id: model.id, configured: configured.has(model.id) })),
    );
    expect(options.map((option) => option.id)).toEqual(SUPPORTED_MODELS.map((model) => model.id));
    expect(options.every((option) => option.configured === configured.has(option.id))).toBe(true);
  });
  it("rejects fewer than two or more than twenty-one statements without dropping excess lines", () => {
    expect(() => prepareCheckInput(" \n\t")).toThrow("2–21");
    expect(() => prepareCheckInput("one statement\n\n")).toThrow("2–21");
    const statements = Array.from({ length: 21 }, (_, index) => `statement ${index + 1}`);
    expect(prepareCheckInput(statements.join("\n")).against).toHaveLength(20);
    expect(() => prepareCheckInput([...statements, "extra"].join("\n"))).toThrow("2–21");
  });
  it("ships an external-script shell with no pre-rendered secrets or executed sample", () => {
    const page = dashboardPage();
    expect(page).toContain('src="/dashboard.js"');
    expect(page).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
    expect(page).toContain('id="new-secret"></code>');
    expect(page).toContain(
      'id="copy-secret" class="icon-button" type="button" data-icon-copy aria-label="Copy API key"',
    );
    expect(page).toContain(
      'id="copy-curl" class="icon-button" type="button" data-icon-copy aria-label="Copy cURL example"',
    );
    expect(page).toContain("Synthetic sample · not yet checked");
    expect(page).toContain('id="statements"');
    expect(page).toContain("One statement per line.");
    expect(page).not.toContain('id="add-comparison"');
  });
});

describe("administrator technical usage", () => {
  it("renders independent request states without turning failed or rejected requests into completions", () => {
    const output = renderUsageRollups([
      {
        tenant_id: "<script>private</script>",
        channel: "dashboard",
        profile: "balanced-v1",
        requests: 9,
        admitted: 7,
        dispatches: 6,
        completed: 4,
        errors: 2,
        rejected: 2,
      },
    ]);
    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;private&lt;/script&gt;");
    expect(output).toContain("<td>9</td><td>7</td><td>6</td><td>4</td><td>2</td><td>2</td>");
    expect(output).toContain("dashboard");
    expect(output).toContain("balanced-v1");
  });
});

describe("mailbox-first authentication interface", () => {
  it("offers only an email link and safely renders the resend address", () => {
    const initial = renderAuthForm("signin", "");
    const sent = renderAuthForm("sent", '" autofocus onfocus="alert(1)');
    expect(initial).toContain("Send sign-in link");
    expect(initial).toContain('type="email"');
    expect(initial).not.toMatch(/password|Create account|Forgot password/i);
    expect(sent).toContain("Resend sign-in link");
    expect(sent).toContain("Use a different email");
    expect(sent).toContain('value="&quot; autofocus onfocus=&quot;alert(1)" readonly');
    expect(sent).not.toContain('value="" autofocus');
  });
  it("offers a bounded use-case note only after access is required and confirms pending review", () => {
    const request = renderAuthForm("request", 'person@example.test" autofocus');
    const received = renderAuthForm("requested", "person@example.test");
    expect(request).toContain("Request access");
    expect(request).toContain('id="back-to-signin">Back to sign in</button>');
    expect(request).toContain('name="note" maxlength="2000"');
    expect(request).toContain('value="person@example.test&quot; autofocus"');
    expect(request).toContain("Visible to administrators; do not include claims or documents.");
    expect(received).toContain("Access requires manual approval.");
    expect(received).toContain("does not sign you in or send an email");
  });
  it("escapes access-request details and shows accepted invitations as persistent access", () => {
    const requests = renderAccessRequests([
      {
        email: '<img src=x onerror="alert(1)">',
        note: "First line\n<script>bad</script>",
        requestedAt: "2026-11-04T12:00:00Z",
      },
    ]);
    const invitations = renderAdminInvitations([
      {
        email: "accepted@example.test",
        createdAt: "2026-11-01T12:00:00Z",
        expiresAt: "2026-11-08T12:00:00Z",
        acceptedAt: "2026-11-02T12:00:00Z",
      },
    ]);
    expect(requests).not.toContain("<img");
    expect(requests).not.toContain("<script>");
    expect(requests).toContain("data-allow-access=");
    expect(requests).toContain("data-dismiss-access=");
    expect(invitations).toContain("Accepted");
    expect(invitations).toContain("access remains active");
  });
});
