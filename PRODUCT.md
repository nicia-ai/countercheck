# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web application and HTTP API.

## Stack

Hono on Cloudflare Workers, Better Auth, and a vanilla TypeScript dashboard bundled with esbuild. The dashboard uses same-origin session cookies; integrations use API keys.

## Users

Developers evaluating contradiction checks for contracts, finance, policy, or another application. Their immediate task is to submit a claim and comparison texts, understand the result, then integrate the API.

## Product Purpose

Countercheck compares one submitted claim with 1–20 submitted texts and returns a verdict for each comparison, evidence identifiers, and uncertainty. It does not retrieve or maintain a customer corpus.

## Positioning

A bounded contradiction-checking API with an evaluation-preview dashboard. No profile is production-qualified. An uncertain result is part of the contract, and a completed check is not a guarantee that no contradiction exists.

## Operating Context

The first visit may be an evaluation rather than a committed integration. Email-link sign-in, invitation eligibility, admission, quotas, and provider availability can prevent a check; the interface must explain the current state and a useful next action.

## Capabilities and Constraints

- Email-link authentication through Better Auth. An invited developer proves access to the mailbox before account creation and session issuance; the dashboard has no password signup, sign-in, or recovery flow.
- One-time API key display, key revocation, and session-authenticated playground checks.
- One statement per line in a single playground editor; the first nonblank statement is compared with each following statement.
- Actual usage counters, limits, and 30-day history supplied by the account API.
- No browser storage of API keys, submitted text, or check results. No automatic sample execution.
- Server input and compiled-payload limits are authoritative. Input is never silently shortened.
- The pilot is invitation-only. Administrators invite an email for 7 days; developers request a sign-in link and prove access to that mailbox. The UI displays the returned admission state rather than promising access.

## Brand Commitments

Plain language, visible uncertainty, exact evidence identifiers, and honest boundaries. No invented performance, customer proof, pricing, or usage statistics.

## Evidence on Hand

The repository contains public and synthetic evaluation artifacts. They document development measurements and limitations, not production qualification. Dashboard numbers come from live account responses only.

## Product Principles

1. Make the first successful check easy to reach.
2. Keep the submitted input and returned verdict traceable.
3. Preserve uncertainty and failures without converting them into a clean result.
4. Explain account restrictions where they affect the task.
5. Keep secrets transient and deliberate.

## Accessibility & Inclusion

Keyboard-operable native controls, visible focus, explicit labels, readable contrast, responsive layouts, and live status announcements. Reduced motion is respected. Evaluation coverage is English-only.

## Scope

The dashboard is an invitation-only developer workbench with Overview, Keys, Playground and Usage views. Commercial terms are outside this interface. The evaluation harness also supports model builders without requiring a dashboard account.
