import type { CheckRequest, CheckResponse, Verdict } from "../src/contracts/index.js";
import {
  DEFAULT_MODEL,
  MODEL_IDS,
  SUPPORTED_MODELS,
  type Model,
  type ModelCatalogEntry,
} from "../src/contracts/models.js";
import type { GlobalUsageSnapshot, UsageSnapshot } from "../src/control/admission.js";

const isSupportedModel = (value: string): value is Model =>
  (MODEL_IDS as readonly string[]).includes(value);
type ModelCatalogResponse = { default: string; models: ModelCatalogEntry[] };
type ModelOptionElement = { value: string; disabled: boolean; textContent: string | null };
type ModelSelectElement = {
  value: string;
  disabled: boolean;
  options: ArrayLike<ModelOptionElement>;
  selectedOptions: ArrayLike<Pick<ModelOptionElement, "disabled">>;
};
const modelSelect = (): ModelSelectElement => $("#check-model") as unknown as ModelSelectElement;
export function modelAvailability(
  entries: readonly Pick<ModelCatalogEntry, "id" | "configured">[],
): { id: Model; name: string; configured: boolean }[] {
  const configuredById = new Map(entries.map((entry) => [entry.id, entry.configured]));
  return SUPPORTED_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    configured: configuredById.get(model.id) === true,
  }));
}

type Account = {
  user: { name: string; email: string; emailVerified: boolean };
  tenantId?: string | null;
  isAdmin?: boolean;
  admission: {
    status:
      "active" | "full" | "unavailable" | "unverified" | "invitation_required" | "not_invited";
  };
};
type KeyMetadata = {
  id: string;
  name?: string | null;
  prefix?: string;
  created_at?: string | number;
  expires_at?: string | number | null;
  revoked_at?: string | number | null;
  status?: string;
};
type AuthMode = "signin" | "sent" | "request" | "requested";
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing dashboard element: ${selector}`);
  return element;
};
const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const number = (value: number): string => value.toLocaleString();
const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).byteLength;
const date = (value: string | number | null | undefined): string =>
  value == null
    ? "Never"
    : Number.isNaN(new Date(value).getTime())
      ? "Unavailable"
      : new Date(value).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
const verdictNames: Record<Verdict, string> = {
  contradiction: "Contradiction detected",
  no_contradiction_detected: "No contradiction detected",
  uncertain: "Uncertain",
};
const sample = {
  claim: "Single sign-on is included in every plan.",
  against: "Single sign-on is available on the Enterprise plan only.",
};
let account: Account | null = null;
let usage: UsageSnapshot | null = null;
let result: CheckResponse | null = null;
let authEmail = "";
let checkBusy = false;
let modelCatalogLoaded = false;

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      "network_error",
      "Could not connect. Check your connection and try again.",
      0,
    );
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const detail =
      data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>) : data;
    const code = String(detail.code ?? data.code ?? "request_failed");
    const safe: Record<string, string> = {
      key_limit: "Three live keys are already active. Revoke one before creating another.",
      email_not_verified: "Verify your email before continuing.",
      email_verification_required: "Verify your email before continuing.",
      INVITATION_REQUIRED:
        "This pilot is invitation-only. Ask your administrator to invite this email address.",
      invitation_required:
        "This pilot is invitation-only. Ask your administrator to invite this email address.",
      beta_full: "The beta is currently full. Your account is saved; check back for access.",
      daily_quota_exceeded: "Today’s allowance has been reached. Try again after the daily reset.",
      tenant_rate_limited: "Too many checks in a short time. Wait a moment, then try again.",
      inflight_limit: "Your account already has checks in progress. Wait for them to finish.",
      admission_unavailable: "Account access is temporarily unavailable. Please try again later.",
      admission_paused: "Checks are paused for this account. Please try again later.",
      tenant_not_enrolled: "Your account does not have beta access yet.",
      EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
      INVALID_TOKEN: "This link is invalid or has expired. Request a new link.",
      compiled_input_too_large:
        "The combined check is too large. Use fewer or shorter comparison texts and try again.",
      payload_too_large:
        "This input exceeds the request or compiled-payload limit. Shorten it explicitly and try again.",
      invalid_request:
        "The check could not accept this input. Check the text sizes and comparison count.",
      upstream_timeout: "The check timed out. No verdict was returned. You can try again.",
      upstream_unavailable:
        "The decision provider is unavailable. No verdict was returned. Try again later.",
    };
    throw new ApiError(
      code,
      safe[code] ??
        (response.status === 401
          ? "Your session has expired. Sign in again."
          : response.status === 403
            ? "This action is not available for your account."
            : response.status === 429
              ? "A request limit has been reached. Wait, then try again."
              : response.status >= 500
                ? "The service could not complete this request. Please try again later."
                : "The request could not be completed. Check the details and try again."),
      response.status,
    );
  }
  return value as T;
}
function selectedModelConfigured(): boolean {
  const select = modelSelect();
  const selected = select.selectedOptions[0];
  return modelCatalogLoaded && selected !== undefined && selected.disabled === false;
}
async function loadModelCatalog(): Promise<void> {
  const select = modelSelect();
  const retry = $("#retry-models") as HTMLButtonElement;
  const previousSelection = select.value;
  modelCatalogLoaded = false;
  select.disabled = true;
  retry.disabled = true;
  retry.textContent = "Loading…";
  status("#model-catalog-status", "Loading model availability…");
  applyAccess();
  try {
    const catalog = await request<ModelCatalogResponse>("/v1/models");
    const entriesById = new Map(catalog.models.map((entry) => [entry.id, entry]));
    if (
      !Array.isArray(catalog.models) ||
      SUPPORTED_MODELS.some((model) => typeof entriesById.get(model.id)?.configured !== "boolean")
    )
      throw new Error("The model catalog is incomplete.");
    const availability = modelAvailability(catalog.models);
    for (const option of Array.from(select.options)) {
      const model = availability.find((entry) => entry.id === option.value);
      if (!model) continue;
      option.disabled = !model.configured;
      option.textContent = model.configured ? model.name : `${model.name} — Not configured`;
    }
    const previousAvailable = availability.some(
      (model) => model.id === previousSelection && model.configured,
    );
    select.value = previousAvailable ? previousSelection : DEFAULT_MODEL;
    modelCatalogLoaded = true;
    select.disabled = false;
    retry.hidden = true;
    retry.disabled = false;
    retry.textContent = "Retry model list";
    const configuredCount = availability.filter((model) => model.configured).length;
    status(
      "#model-catalog-status",
      configuredCount === 0
        ? "No models are configured for this deployment. Contact the administrator."
        : !selectedModelConfigured()
          ? `${DEFAULT_MODEL} is not configured. Choose an available model to run a check.`
          : "Available models loaded. Unconfigured models are disabled.",
      configuredCount === 0,
    );
    applyAccess();
  } catch {
    modelCatalogLoaded = false;
    select.disabled = true;
    retry.hidden = false;
    retry.disabled = false;
    retry.textContent = "Retry model list";
    status(
      "#model-catalog-status",
      "Could not load the model list. Retry to check which providers are configured.",
      true,
    );
    applyAccess();
  }
}
function announce(message: string): void {
  $("#global-status").textContent = message;
}
function status(id: string, message: string, error = false): void {
  const target = $(id);
  target.textContent = message;
  target.classList.toggle("error", error);
}
async function task(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  button.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    button.disabled = false;
    button.textContent = label;
    button.removeAttribute("aria-busy");
    applyAccess();
  }
}
export function renderAuthForm(mode: AuthMode, email: string): string {
  const sent = mode === "sent";
  if (mode === "request" || mode === "requested") {
    const complete = mode === "requested";
    return `<h1>${complete ? "Request received" : "Request access"}</h1><p class="intro">${complete ? "Your request was received. Access requires manual approval. This does not sign you in or send an email. If access is approved, return here and request a sign-in link." : "This email is not on the access list yet. Send a request for manual review."}</p>${complete ? '<div class="auth-links"><button class="text-button" id="back-to-signin">Back to sign in</button></div>' : `<form id="auth-form" class="auth-form"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required></div><div class="field"><label for="access-note">What would you like to use Countercheck for? <span class="optional-label">Optional</span></label><textarea id="access-note" name="note" maxlength="2000" rows="4" aria-describedby="access-note-hint" placeholder="A short description of your use case"></textarea><span id="access-note-hint" class="field-hint">Up to 2,000 characters. Visible to administrators; do not include claims or documents.</span></div><button class="button primary" type="submit">Send access request</button></form><p id="auth-status" class="form-status" role="status"></p><div class="auth-links"><button class="text-button" id="back-to-signin">Back to sign in</button></div>`}<p class="auth-note">Requests are reviewed manually. No sign-in link is sent with this request.</p>`;
  }
  return `<h1>${sent ? "Check your inbox" : "Sign in to Countercheck"}</h1><p class="intro">${sent ? "If this email has access, a sign-in link is on its way. Open it to finish signing in." : "Invitation-only pilot. We’ll send a one-time sign-in link to your invited email address."}</p><form id="auth-form" class="auth-form"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" ${sent ? "readonly" : ""} required></div><button class="button primary" type="submit">${sent ? "Resend sign-in link" : "Send sign-in link"}</button></form><p id="auth-status" class="form-status" role="status"></p>${sent ? '<div class="auth-links"><button class="text-button" id="change-auth-email">Use a different email</button></div>' : ""}<p class="auth-note">Your email link establishes access. English evaluation preview; account limits apply.</p>`;
}
function showAuth(mode: AuthMode = "signin"): void {
  if (!$("#workspace").hidden) {
    ($("#statements") as HTMLTextAreaElement).value = "";
    updateCounts();
  }
  account = null;
  usage = null;
  result = null;
  $("#new-secret").textContent = "";
  $("#secret-panel").hidden = true;
  $("#results").hidden = true;
  $("#result-json").textContent = "";
  $("#result-rows").replaceChildren();
  $("#admin-content").replaceChildren();
  $("#boot").hidden = true;
  $("#workspace").hidden = true;
  $("#auth").hidden = false;
  $("#auth-content").innerHTML = renderAuthForm(mode, authEmail);
  if (mode !== "requested")
    $("#auth-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void (mode === "request" ? accessRequestSubmit() : authSubmit());
    });
  document.querySelector("#change-auth-email")?.addEventListener("click", () => {
    showAuth("signin");
    $("#auth-email").focus();
  });
  document.querySelector("#back-to-signin")?.addEventListener("click", () => showAuth("signin"));
}
async function authSubmit(): Promise<void> {
  const form = $("#auth-form") as HTMLFormElement;
  if (!form.reportValidity()) return;
  authEmail = String(new FormData(form).get("email"));
  await task(form.querySelector("button")!, async () => {
    status("#auth-status", "");
    try {
      await request("/api/auth/sign-in/magic-link", {
        email: authEmail,
        callbackURL: "/dashboard",
        errorCallbackURL: "/dashboard",
      });
      showAuth("sent");
    } catch (error) {
      if (error instanceof ApiError && error.code.toUpperCase() === "ACCESS_REQUIRED") {
        showAuth("request");
        return;
      }
      status(
        "#auth-status",
        error instanceof Error ? error.message : "Could not request a sign-in link.",
        true,
      );
    }
  });
}
async function accessRequestSubmit(): Promise<void> {
  const form = $("#auth-form") as HTMLFormElement;
  if (!form.reportValidity()) return;
  const fields = new FormData(form);
  authEmail = String(fields.get("email") ?? "").trim();
  const note = String(fields.get("note") ?? "").trim();
  if (note.length > 2000) {
    status("#auth-status", "Keep the use case note to 2,000 characters or fewer.", true);
    return;
  }
  await task(form.querySelector("button")!, async () => {
    status("#auth-status", "");
    try {
      await request<{ requested: true }>("/dashboard/api/access-requests", {
        email: authEmail,
        ...(note ? { note } : {}),
      });
      showAuth("requested");
      announce("Access request received and pending manual review.");
    } catch (error) {
      status(
        "#auth-status",
        error instanceof Error ? error.message : "Could not submit the access request.",
        true,
      );
    }
  });
}
async function loadAccount(): Promise<void> {
  try {
    account = await request<Account>("/dashboard/api/me");
    if (!account?.user) {
      showAuth("signin");
      return;
    }
    authEmail = account.user.email;
    $("#boot").hidden = true;
    $("#auth").hidden = true;
    $("#workspace").hidden = false;
    $("#account-email").textContent = account.user.email;
    $("#admin-nav").hidden = !account.isAdmin;
    usage = null;
    applyAccess();
    navigate();
    if (account.admission.status === "active") await Promise.allSettled([loadUsage(), loadKeys()]);
    else {
      const message =
        "Usage and API keys are available after an invited email-link sign-in and beta admission.";
      $("#overview-usage").textContent = message;
      $("#usage-summary").textContent = message;
      $("#key-rows").innerHTML =
        '<tr><td colspan="6" class="empty-cell">Account access is required before creating API keys.</td></tr>';
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showAuth("signin");
    else {
      showAuth("signin");
      status(
        "#auth-status",
        error instanceof Error ? error.message : "Could not open your workspace.",
        true,
      );
    }
  }
}
function accessMessage(): string | null {
  if (!account?.user.emailVerified)
    return "Sign in with an email link to create keys and run checks.";
  if (["invitation_required", "not_invited"].includes(account.admission.status))
    return "This pilot is invitation-only. Ask your administrator to invite your account email before trying a check.";
  if (account.admission?.status === "full")
    return "The beta is currently full. Your account is saved, but checks and API key creation are not available yet.";
  if (account.admission?.status !== "active")
    return "Beta access is temporarily unavailable. Your account is saved; try again later.";
  if (usage?.paused || usage?.globalPaused)
    return "Checks are currently paused. Your existing account and keys are saved.";
  if (
    usage &&
    (usage.today.attempts >= usage.limits.tenantAttemptsPerDay ||
      usage.today.comparisons >= usage.limits.tenantComparisonsPerDay)
  )
    return "Today’s account allowance has been reached. Checks resume after the daily reset.";
  return null;
}
function applyAccess(): void {
  if (!account) return;
  const message = accessMessage();
  const badge = $("#account-state");
  badge.textContent = message
    ? account.user.emailVerified
      ? "Access limited"
      : "Email unverified"
    : "Ready to check";
  badge.className = `status-pill ${message ? "warning" : "active"}`;
  const notice = $("#notice");
  notice.hidden = !message;
  notice.replaceChildren();
  if (message) {
    const p = document.createElement("p");
    p.textContent = message;
    notice.appendChild(p);
    if (!account.user.emailVerified) {
      const button = document.createElement("button");
      button.className = "text-button";
      button.textContent = "Sign in with your email";
      button.addEventListener("click", () => showAuth("signin"));
      notice.appendChild(button);
    }
  }
  document.querySelectorAll<HTMLButtonElement>("[data-requires-active]").forEach((button) => {
    button.disabled =
      Boolean(message) ||
      (button.id === "run-check" && (checkBusy || !selectedModelConfigured())) ||
      (button.closest("#key-form") !== null && !$("#secret-panel").hidden);
  });
}
function navigate(): void {
  const id = location.hash.slice(1) || "overview";
  const selected = [
    "overview",
    "keys",
    "playground",
    "usage",
    ...(account?.isAdmin ? ["admin"] : []),
  ].includes(id)
    ? id
    : "overview";
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== selected;
  });
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((link) => {
    if (link.dataset.nav === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${selected === "keys" ? "API keys" : selected[0]!.toUpperCase() + selected.slice(1)} · Countercheck`;
  if (selected === "admin" && account?.isAdmin) void loadAdmin();
}
function usageDefinitions(snapshot: UsageSnapshot): string {
  const remainingAttempts = Math.max(
    0,
    snapshot.limits.tenantAttemptsPerDay - snapshot.today.attempts,
  );
  const remainingComparisons = Math.max(
    0,
    snapshot.limits.tenantComparisonsPerDay - snapshot.today.comparisons,
  );
  return [
    [
      "Daily checks remaining",
      `${number(remainingAttempts)} of ${number(snapshot.limits.tenantAttemptsPerDay)}`,
    ],
    [
      "Daily comparisons remaining",
      `${number(remainingComparisons)} of ${number(snapshot.limits.tenantComparisonsPerDay)}`,
    ],
    [
      "Checks in progress",
      `${number(snapshot.inflight)} of ${number(snapshot.limits.tenantInflight)}`,
    ],
    ["Request rate", `Up to ${number(snapshot.limits.requestsPerMinute)} checks per minute`],
    ["Usage day (UTC)", snapshot.day],
  ]
    .map(
      ([label, value]) =>
        `<div class="definition-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
}
async function loadUsage(): Promise<void> {
  try {
    const data = await request<UsageSnapshot | { usage: UsageSnapshot }>("/dashboard/api/usage");
    usage = "usage" in data ? data.usage : data;
    $("#overview-usage").innerHTML = usageDefinitions(usage);
    $("#usage-summary").innerHTML = usageDefinitions(usage);
    $("#usage-head").innerHTML =
      "<tr><th>Day (UTC)</th><th>Checks</th><th>Comparisons</th><th>Completed</th><th>Failed</th><th>Timed out</th><th>Aborted</th><th>Pending</th><th>Input tokens</th></tr>";
    $("#usage-rows").innerHTML = usage.history.length
      ? usage.history
          .map(
            (day) =>
              `<tr><td>${escapeHtml(day.day)}</td><td>${number(day.attempts)}</td><td>${number(day.comparisons)}</td><td>${number(day.completed)}</td><td>${number(day.failed)}</td><td>${number(day.timeout)}</td><td>${number(day.aborted)}</td><td>${number(day.pending)}</td><td>${number(day.knownInputTokens)}${day.unknownInputTokenAttempts ? ` + ${number(day.unknownInputTokenAttempts)} unknown` : ""}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="9" class="empty-cell">Your checks will appear here. No activity has been recorded yet.</td></tr>';
    applyAccess();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load usage.";
    $("#overview-usage").textContent = message;
    $("#usage-summary").textContent = message;
  }
}
async function loadKeys(): Promise<void> {
  try {
    const data = await request<{ keys: KeyMetadata[] }>("/dashboard/api/keys");
    $("#key-rows").innerHTML = data.keys.length
      ? data.keys
          .map((key) => {
            const revoked = Boolean(key.revoked_at) || key.status === "revoked";
            const expired =
              key.expires_at != null && new Date(key.expires_at).getTime() <= Date.now();
            return `<tr><td>${escapeHtml(key.name || "Untitled key")}</td><td><code>${escapeHtml(key.prefix ?? "Hidden")}</code></td><td>${escapeHtml(date(key.created_at))}</td><td>${escapeHtml(date(key.expires_at))}</td><td><span class="status-pill ${revoked || expired ? "" : "active"}">${revoked ? "Revoked" : expired ? "Expired" : "Active"}</span></td><td>${revoked ? "" : `<button class="text-button" data-revoke="${escapeHtml(key.id)}" data-name="${escapeHtml(key.name || "this key")}">Revoke</button>`}</td></tr>`;
          })
          .join("")
      : '<tr><td colspan="6" class="empty-cell">No API keys yet. You can try the playground before creating one.</td></tr>';
  } catch (error) {
    status("#key-status", error instanceof Error ? error.message : "Could not load keys.", true);
  }
}
async function copy(text: string, button: HTMLButtonElement, itemLabel = "content"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (button.hasAttribute("data-icon-copy")) {
      button.classList.add("copied");
      button.disabled = true;
      button.closest(".code-copy")?.classList.remove("copy-error");
      const feedback = button.nextElementSibling;
      if (feedback instanceof HTMLElement) {
        feedback.textContent = "Copied";
        feedback.classList.remove("error");
        feedback.hidden = false;
      }
      announce(`${itemLabel} copied to clipboard.`);
      window.setTimeout(() => {
        button.classList.remove("copied");
        button.disabled = false;
        if (feedback instanceof HTMLElement) feedback.hidden = true;
      }, 1600);
      return;
    }
    const before = button.textContent;
    button.textContent = "Copied";
    button.disabled = true;
    announce("Copied to clipboard.");
    window.setTimeout(() => {
      button.textContent = before;
      button.disabled = false;
    }, 2000);
  } catch {
    announce(`Clipboard access is unavailable. Select the ${itemLabel} and copy it manually.`);
    if (button.hasAttribute("data-icon-copy")) {
      button.closest(".code-copy")?.classList.add("copy-error");
      const feedback = button.nextElementSibling;
      if (feedback instanceof HTMLElement) {
        feedback.textContent = "Select manually";
        feedback.classList.add("error");
        feedback.hidden = false;
      }
    } else button.textContent = "Select and copy manually";
  }
}
function statementLines(text: string): { id: string; text: string }[] {
  return text
    .split(/\r\n|\n|\r/)
    .flatMap((line, index) => (line.trim() ? [{ id: `line_${index + 1}`, text: line }] : []));
}
function updateCounts(): void {
  const lines = statementLines(($("#statements") as HTMLTextAreaElement).value);
  const hint = $("#statements-count");
  const oversized = lines.find((line, index) => bytes(line.text) > (index === 0 ? 4096 : 2048));
  hint.textContent = oversized
    ? `Line ${oversized.id.slice(5)} exceeds its text limit. Shorten it before checking.`
    : `${number(lines.length)} ${lines.length === 1 ? "statement" : "statements"} · ${number(Math.max(0, lines.length - 1))} ${lines.length === 2 ? "comparison" : "comparisons"} · 2–21 statements allowed`;
  hint.classList.toggle("over-limit", !!oversized || lines.length > 21);
}
export function prepareCheckInput(statements: string, model: Model = DEFAULT_MODEL): CheckRequest {
  if (!isSupportedModel(model)) throw new Error("Choose one of the supported models.");
  const lines = statementLines(statements);
  if (lines.length < 2 || lines.length > 21)
    throw new Error("Enter 2–21 statements, one per line.");
  const [claim, ...against] = lines;
  const oversized = lines.find((line, index) => bytes(line.text) > (index === 0 ? 4096 : 2048));
  if (oversized)
    throw new Error(
      `Line ${oversized.id.slice(5)} exceeds its byte limit. Shorten it before checking.`,
    );
  const payload: CheckRequest = { model, claim: claim!, against, profile: "balanced-v1" };
  if (bytes(JSON.stringify(payload)) > 65536)
    throw new Error(
      "The complete request exceeds 64 KiB. Shorten it explicitly before trying again.",
    );
  return payload;
}
function invalidateResult(): void {
  result = null;
  $("#results").hidden = true;
  status("#check-status", "Input changed. Run a new check to assess this text.");
}
function lockEditor(locked: boolean): void {
  document.querySelectorAll<HTMLTextAreaElement>("#check-form textarea").forEach((input) => {
    input.disabled = locked;
  });
  modelSelect().disabled = locked;
  ($("#load-sample") as HTMLButtonElement).disabled = locked;
}
async function runCheck(): Promise<void> {
  const form = $("#check-form") as HTMLFormElement;
  if (!modelCatalogLoaded) {
    status("#check-status", "Load the model list before running a check.", true);
    return;
  }
  if (!selectedModelConfigured()) {
    status("#check-status", "Choose a configured model before running a check.", true);
    return;
  }
  if (!form.reportValidity() || accessMessage()) return;
  let payload: CheckRequest;
  try {
    const modelId = modelSelect().value;
    if (!isSupportedModel(modelId)) throw new Error("Choose one of the supported models.");
    payload = prepareCheckInput(($("#statements") as HTMLTextAreaElement).value, modelId);
  } catch (error) {
    status("#check-status", error instanceof Error ? error.message : "Check the input.", true);
    return;
  }
  checkBusy = true;
  lockEditor(true);
  applyAccess();
  updateCounts();
  result = null;
  $("#results").hidden = true;
  status("#check-status", "Checking your submitted texts…");
  const button = $("#run-check") as HTMLButtonElement;
  button.textContent = "Checking…";
  button.setAttribute("aria-busy", "true");
  try {
    result = await request<CheckResponse>("/dashboard/api/check", payload);
    renderResult(result);
    status("#check-status", "Check completed. Inspect the results below.");
    announce("Check completed.");
  } catch (error) {
    status(
      "#check-status",
      error instanceof Error ? error.message : "The check failed. No verdict was returned.",
      true,
    );
    if (error instanceof ApiError && error.status === 401) {
      account = null;
      showAuth("signin");
      status("#auth-status", "Your session expired. Sign in to continue.", true);
    }
  } finally {
    checkBusy = false;
    lockEditor(false);
    button.textContent = "Run check →";
    button.removeAttribute("aria-busy");
    applyAccess();
    updateCounts();
    if (account) void loadUsage();
  }
}
function renderResult(value: CheckResponse): void {
  $("#results").hidden = false;
  $("#request-id").textContent = value.request_id;
  $("#result-summary").innerHTML =
    `<div class="result-summary"><strong>Check completed</strong><span>${value.coverage.completed} of ${value.coverage.requested} comparisons assessed</span></div>`;
  $("#result-rows").innerHTML = value.comparisons
    .map(
      (comparison) =>
        `<article class="result-row"><header><h3><code>${escapeHtml(comparison.against_id)}</code></h3><span class="status-pill ${comparison.verdict === "no_contradiction_detected" ? "active" : comparison.verdict === "contradiction" ? "danger" : "warning"}">${escapeHtml(verdictNames[comparison.verdict])}</span></header><p><code>${escapeHtml(comparison.verdict)}</code> · ${escapeHtml(comparison.reason.replaceAll("_", " "))}</p><div class="evidence-line">Evidence: <code>${escapeHtml(comparison.evidence.claim_id)}</code> ↔ <code>${escapeHtml(comparison.evidence.against_id)}</code> · ${escapeHtml(comparison.evidence.granularity)}</div>${
          comparison.raw_scores
            ? `<div class="score-list">${Object.entries(comparison.raw_scores)
                .map(
                  ([name, p]) =>
                    `<span>${escapeHtml(name.replaceAll("_", " "))} <strong>${(p * 100).toFixed(1)}%</strong></span>`,
                )
                .join("")}</div>`
            : ""
        }</article>`,
    )
    .join("");
  $("#result-json").textContent = JSON.stringify(value, null, 2);
}
type UsageRollup = {
  tenant_id: string;
  channel: string;
  profile: string;
  requests: number;
  admitted: number;
  dispatches: number;
  completed: number;
  errors: number;
  rejected: number;
};
export function renderUsageRollups(rows: UsageRollup[]): string {
  return `<section class="section-block"><h2>Usage by channel and profile</h2><p class="usage-note">Last 30 UTC dates. Technical rollups are advisory; the daily allowance above is the admission authority. Errors count server failures; rejected requests were not admitted.</p><div class="table-wrap"><table><caption class="sr-only">Technical usage by tenant, channel and profile</caption><thead><tr><th>Tenant</th><th>Channel</th><th>Profile</th><th>Requests</th><th>Admitted</th><th>Dispatches</th><th>Completed</th><th>Errors</th><th>Rejected</th></tr></thead><tbody>${rows.map((row) => `<tr><td><code>${escapeHtml(row.tenant_id)}</code></td><td>${escapeHtml(row.channel)}</td><td><code>${escapeHtml(row.profile)}</code></td>${[row.requests, row.admitted, row.dispatches, row.completed, row.errors, row.rejected].map((value) => `<td>${number(value)}</td>`).join("")}</tr>`).join("") || '<tr><td colspan="9" class="empty-cell">No technical usage recorded yet. Requests will appear here by channel and profile.</td></tr>'}</tbody></table></div></section>`;
}
type AccessRequestRecord = { email: string; note?: string | null; requestedAt: string | number };
type AdminInvitation = {
  email: string;
  createdAt: string | number;
  expiresAt: string | number;
  acceptedAt?: string | number | null;
};
export function renderAccessRequests(requests: AccessRequestRecord[]): string {
  return requests.length
    ? requests
        .map(
          (item) =>
            `<tr><td><code>${escapeHtml(item.email)}</code></td><td>${escapeHtml(date(item.requestedAt))}</td><td class="access-note">${item.note ? escapeHtml(item.note) : "No note provided"}</td><td><div class="access-request-actions"><button class="button" type="button" data-allow-access="${escapeHtml(item.email)}">Allow access</button><button class="text-button danger-text" type="button" data-dismiss-access="${escapeHtml(item.email)}">Dismiss</button></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="empty-cell">No pending access requests.</td></tr>';
}
export function renderAdminInvitations(invitations: AdminInvitation[]): string {
  return invitations.length
    ? invitations
        .map((item) => {
          const accepted = item.acceptedAt != null;
          const expired = !accepted && new Date(item.expiresAt).getTime() <= Date.now();
          const state = accepted
            ? `Accepted ${escapeHtml(date(item.acceptedAt))} · access remains active`
            : expired
              ? "Expired"
              : "Pending acceptance";
          return `<tr><td><code>${escapeHtml(item.email)}</code></td><td>${escapeHtml(date(item.createdAt))}</td><td>${escapeHtml(date(item.expiresAt))}</td><td>${state}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="4" class="empty-cell">No invitations recorded.</td></tr>';
}
async function loadAdmin(): Promise<boolean> {
  if (!account?.isAdmin) return false;
  const currentAccount = account;
  try {
    const [data, accessRequests, invitations] = await Promise.all([
      request<GlobalUsageSnapshot & { rollups: UsageRollup[] }>("/dashboard/api/admin/overview"),
      request<{ requests: AccessRequestRecord[] }>("/dashboard/api/admin/access-requests"),
      request<{ invitations: AdminInvitation[] }>("/dashboard/api/admin/invitations"),
    ]);
    if (account !== currentAccount || !account?.isAdmin) return false;
    const paused = data.paused;
    $("#admin-content").innerHTML =
      `<section class="access-requests-section"><h2>Pending access requests</h2><p class="usage-note">Allow grants a 7-day invitation; Dismiss removes the request without granting access. Neither action sends email.</p><div class="table-wrap"><table><caption class="sr-only">Pending access requests</caption><thead><tr><th>Email</th><th>Requested</th><th>Use case note (unverified)</th><th>Actions</th></tr></thead><tbody>${renderAccessRequests(accessRequests.requests)}</tbody></table></div></section><section class="invitation-section"><h2>Allow an email</h2><p class="usage-note">Access lasts 7 days until the developer accepts it. No email is sent: share ${escapeHtml(location.origin)}/dashboard yourself. Once accepted, access remains active.</p><form id="invitation-form" class="inline-form"><div class="field"><label for="invitation-email">Email to allow</label><input id="invitation-email" name="email" type="email" autocomplete="off" required></div><button class="button primary" type="submit">Allow access</button></form><p id="invitation-status" class="form-status" role="status"></p></section><section class="allowed-emails-section"><h2>Allowed emails</h2><div class="table-wrap"><table><caption class="sr-only">Allowed email invitations</caption><thead><tr><th>Email</th><th>Allowed</th><th>Accept by</th><th>Status</th></tr></thead><tbody>${renderAdminInvitations(invitations.invitations)}</tbody></table></div></section><div class="admin-toolbar"><p class="usage-note">Global today: ${number(data.today.attempts)} checks / ${number(data.limits.globalAttemptsPerDay)} · ${number(data.today.comparisons)} comparisons / ${number(data.limits.globalComparisonsPerDay)}</p><button class="button ${paused ? "" : "danger"}" id="global-pause" data-paused="${paused}">${paused ? "Resume all checks" : "Pause all checks"}</button></div><div id="pause-confirm" class="admin-confirm" hidden><label><input type="checkbox" id="pause-ack">I understand that pausing prevents new checks for every tenant.</label><button class="button danger" id="confirm-global-pause">Confirm global pause</button> <button class="text-button" id="cancel-global-pause">Cancel</button></div><p id="admin-status" class="form-status" role="status"></p><div class="table-wrap"><table><thead><tr><th>Tenant</th><th>Checks today</th><th>Comparisons</th><th>In progress</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.tenants.map((tenant) => `<tr><td><code>${escapeHtml(tenant.tenantId)}</code></td><td>${number(tenant.today.attempts)}</td><td>${number(tenant.today.comparisons)}</td><td>${number(tenant.inflight)}</td><td>${tenant.paused ? "Paused" : "Active"}</td><td><button class="text-button" data-tenant-pause="${escapeHtml(tenant.tenantId)}" data-paused="${tenant.paused}">${tenant.paused ? "Resume" : "Pause"}</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty-cell">No enrolled tenants.</td></tr>'}</tbody></table></div>${renderUsageRollups(data.rollups)}`;
    return true;
  } catch (error) {
    if (account !== currentAccount || !account?.isAdmin) return false;
    $("#admin-content").textContent =
      error instanceof Error ? error.message : "Could not load administration.";
    return false;
  }
}
function actionFeedback(message: string, selector: string, refreshed: boolean): void {
  if (!account?.isAdmin) return;
  if (!refreshed) {
    $("#admin-content").innerHTML =
      `<p class="form-status" role="status">${escapeHtml(message)}</p><p class="usage-note">The action completed, but this view did not refresh. Use Refresh to reload the access lists.</p>`;
    announce(message);
    return;
  }
  const target = document.querySelector<HTMLElement>(selector);
  if (target) status(selector, message);
  else announce(message);
}
async function allowAccess(
  email: string,
  button: HTMLButtonElement,
  feedbackSelector = "#admin-status",
): Promise<void> {
  await task(button, async () => {
    try {
      const data = await request<{ invited: true; expiresAt: string | number }>(
        "/dashboard/api/admin/invitations",
        { email },
      );
      const message = `Access allowed until ${date(data.expiresAt)}. No email was sent; share ${location.origin}/dashboard yourself. Once accepted, access remains active.`;
      actionFeedback(message, feedbackSelector, await loadAdmin());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not allow access.";
      const target = document.querySelector<HTMLElement>(feedbackSelector);
      if (target) status(feedbackSelector, message, true);
      else announce(message);
    }
  });
}
async function dismissAccess(email: string, button: HTMLButtonElement): Promise<void> {
  await task(button, async () => {
    try {
      await request<{ dismissed: true }>("/dashboard/api/admin/access-requests/dismiss", {
        email,
      });
      actionFeedback(
        "Request dismissed. No access was granted and no email was sent.",
        "#admin-status",
        await loadAdmin(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not dismiss the request.";
      const target = document.querySelector<HTMLElement>("#admin-status");
      if (target) status("#admin-status", message, true);
      else announce(message);
    }
  });
}
async function adminPause(path: string, paused: boolean, button: HTMLButtonElement): Promise<void> {
  await task(button, async () => {
    try {
      await request(path, { paused });
      await loadAdmin();
      void loadUsage();
      announce(paused ? "Checks paused." : "Checks resumed.");
    } catch (error) {
      status(
        "#admin-status",
        error instanceof Error ? error.message : "Could not update access.",
        true,
      );
    }
  });
}
function initialize(): void {
  window.addEventListener("hashchange", navigate);
  $("#sign-out").addEventListener(
    "click",
    () =>
      void task($("#sign-out") as HTMLButtonElement, async () => {
        try {
          await request("/api/auth/sign-out", {});
          location.assign("/dashboard");
        } catch (error) {
          announce(error instanceof Error ? error.message : "Could not sign out.");
        }
      }),
  );
  $("#key-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    void task(form.querySelector("button")!, async () => {
      try {
        status("#key-status", "");
        const data = await request<{ key: string; id: string }>("/dashboard/api/keys", {
          name: ($("#key-name") as HTMLInputElement).value,
        });
        $("#new-secret").textContent = data.key;
        $("#secret-panel").hidden = false;
        $("#secret-panel").dataset.keyId = data.id;
        form.reset();
        await loadKeys();
        announce("API key created. Copy it now; it is shown only once.");
      } catch (error) {
        status(
          "#key-status",
          error instanceof Error ? error.message : "Could not create key.",
          true,
        );
      }
    });
  });
  $("#copy-secret").addEventListener(
    "click",
    () =>
      void copy(
        $("#new-secret").textContent ?? "",
        $("#copy-secret") as HTMLButtonElement,
        "API key",
      ),
  );
  $("#copy-curl").addEventListener(
    "click",
    () =>
      void copy(
        $("#curl-example").textContent ?? "",
        $("#copy-curl") as HTMLButtonElement,
        "cURL example",
      ),
  );
  $("#dismiss-secret").addEventListener("click", () => {
    $("#new-secret").textContent = "";
    $("#secret-panel").hidden = true;
    applyAccess();
    announce("Key dismissed.");
  });
  $("#key-rows").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const cell = button.closest("td")!;
    if (button.dataset.revoke) {
      button.hidden = true;
      const confirmation = document.createElement("div");
      confirmation.className = "inline-confirm";
      confirmation.innerHTML = `<p>Applications using this key will lose access immediately.</p><div><button class="text-button danger-text" data-confirm-revoke="${escapeHtml(button.dataset.revoke)}">Confirm revoke</button><button class="text-button" data-cancel-revoke>Cancel</button></div>`;
      cell.appendChild(confirmation);
      confirmation.querySelector<HTMLButtonElement>("button")!.focus();
      return;
    }
    if (button.hasAttribute("data-cancel-revoke")) {
      cell.querySelector(".inline-confirm")!.remove();
      const original = cell.querySelector<HTMLButtonElement>("[data-revoke]")!;
      original.hidden = false;
      original.focus();
      return;
    }
    const keyId = button.dataset.confirmRevoke;
    if (!keyId) return;
    void task(button, async () => {
      try {
        await request(`/dashboard/api/keys/${encodeURIComponent(keyId)}/revoke`, {});
        if ($("#secret-panel").dataset.keyId === keyId) {
          $("#new-secret").textContent = "";
          $("#secret-panel").hidden = true;
        }
        await loadKeys();
        status("#key-status", "Key revoked.");
        $("#key-status").tabIndex = -1;
        $("#key-status").focus();
      } catch (error) {
        status(
          "#key-status",
          error instanceof Error ? error.message : "Could not revoke key.",
          true,
        );
      }
    });
  });
  $("#statements").addEventListener("input", () => {
    updateCounts();
    invalidateResult();
  });
  $("#check-model").addEventListener("change", () => {
    invalidateResult();
    status(
      "#model-catalog-status",
      selectedModelConfigured()
        ? "Available model selected. Unconfigured models are disabled."
        : "Choose a configured model to run a check.",
    );
    applyAccess();
  });
  $("#retry-models").addEventListener("click", () => void loadModelCatalog());
  $("#load-sample").addEventListener("click", () => {
    if (checkBusy) return;
    ($("#statements") as HTMLTextAreaElement).value = `${sample.claim}\n${sample.against}`;
    updateCounts();
    invalidateResult();
    status("#check-status", "Synthetic sample loaded. Select Run check to submit it.");
  });
  $("#check-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!checkBusy) void runCheck();
  });
  $("#copy-json").addEventListener("click", () => {
    if (result) void copy(JSON.stringify(result, null, 2), $("#copy-json") as HTMLButtonElement);
  });
  $("#refresh-usage").addEventListener(
    "click",
    () => void task($("#refresh-usage") as HTMLButtonElement, loadUsage),
  );
  $("#refresh-admin").addEventListener(
    "click",
    () =>
      void task($("#refresh-admin") as HTMLButtonElement, async () => {
        await loadAdmin();
      }),
  );
  $("#admin-content").addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id !== "invitation-form") return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    void allowAccess(
      String(new FormData(form).get("email")),
      form.querySelector("button")!,
      "#invitation-status",
    );
  });
  $("#admin-content").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.allowAccess) {
      void allowAccess(button.dataset.allowAccess, button);
      return;
    }
    if (button.dataset.dismissAccess) {
      void dismissAccess(button.dataset.dismissAccess, button);
      return;
    }
    if (button.id === "global-pause") {
      if (button.dataset.paused === "true")
        void adminPause("/dashboard/api/admin/pause", false, button);
      else $("#pause-confirm").hidden = false;
    }
    if (button.id === "cancel-global-pause") $("#pause-confirm").hidden = true;
    if (button.id === "confirm-global-pause") {
      if (($("#pause-ack") as HTMLInputElement).checked)
        void adminPause("/dashboard/api/admin/pause", true, button);
      else status("#admin-status", "Acknowledge the effect before pausing all checks.", true);
    }
    if (button.dataset.tenantPause) {
      const paused = button.dataset.paused !== "true";
      if (!paused || window.confirm("Pause new checks for this tenant?"))
        void adminPause(
          `/dashboard/api/admin/tenants/${encodeURIComponent(button.dataset.tenantPause)}/pause`,
          paused,
          button,
        );
    }
  });
  $("#curl-example").textContent =
    `curl ${location.origin}/v1/check \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"jev-1.14.0","profile":"balanced-v1",\n       "claim":{"id":"claim","text":"…"},\n       "against":[{"id":"comparison_1","text":"…"}]}'`;
  ($("#statements") as HTMLTextAreaElement).value = `${sample.claim}\n${sample.against}`;
  updateCounts();
  const url = new URL(location.href);
  void loadModelCatalog();
  if (url.pathname.endsWith("/reset-password") || url.searchParams.has("error")) {
    history.replaceState(null, "", "/dashboard");
    showAuth("signin");
    status(
      "#auth-status",
      "This link could not sign you in. Request a new email sign-in link.",
      true,
    );
  } else void loadAccount();
}
if (typeof document !== "undefined") initialize();
