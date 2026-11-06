---
name: Countercheck developer workspace
description: A quiet comparison workbench with traceable verdicts.
colors:
  primary: "#176448"
  primary-hover: "#104f38"
  canvas: "#fafaf7"
  navigation: "#f0f1eb"
  surface: "#ffffff"
  ink: "#202823"
  muted: "#58625b"
  border: "#d9ded6"
  selected: "#deeadf"
  contradiction: "#963525"
  contradiction-bg: "#f7e9e5"
  uncertain: "#785619"
  uncertain-bg: "#fbf3df"
  focus: "#24805d"
typography:
  headline:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "30px"
    fontWeight: 620
    lineHeight: 1.23
    letterSpacing: "-0.035em"
  title:
    fontSize: "19px"
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontSize: "13px"
    fontWeight: 600
  code:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
rounded:
  control: "7px"
  work-area: "10px"
  badge: "5px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
---

# Design System: Countercheck

## Overview

**Creative North Star: "The verification workspace"**

A quiet comparison workbench keeps the submitted claim, comparison identifiers, and returned judgments easy to connect. Stable navigation and familiar controls serve the task. The product's text and actual account state provide the hierarchy.

The implementation follows the supplied warm-white, ink, and restrained-emerald brief. This root document records the visual system; `docs/design.md` remains the separate architecture authority. Route-specific direction and provenance are in `.impeccable/surfaces/dashboard.md`.

**Key Characteristics:**

- Warm, flat surfaces and precise row alignment.
- Native system typography and compact, readable controls.
- Distinct contradiction, uncertainty, and completed negative treatments.
- Task-first layouts with explicit loading, empty, restricted, and error states.

Desktop playground, mobile playground, and desktop usage were captured and reviewed. The initial parent review verified the then-current invited signup and verification, first check, usage update, and one-time key/revocation flows. Authentication now uses a single email-link form with a sent/resend state; that security change supersedes the password screens in the initial evidence. The parent’s final rendered recheck confirmed the corrected red comparison badge and completed result; the initial review’s badge-severity finding is resolved. These checks used a synthetic provider and do not qualify live inference.

## Colors

Emerald identifies actions and current navigation. Warm neutrals carry the work. Red marks contradiction; amber marks uncertainty or restricted access. Color accompanies explicit text.

**The Verdict Rule.** Contradiction and uncertainty use different treatments at both aggregate and comparison levels. A negative verdict remains “No contradiction detected,” not a guarantee of truth.

## Typography

The stylesheet uses the declared sans stack with native fallbacks; no remote font is fetched. Headings use modest weight and tighter spacing. Body copy stays near 65–75 characters where the layout permits. Section titles use the title token. Identifiers, source code, and JSON use the code stack; ordinary labels do not.

At mobile widths, primary headings become 26px. Authentication headings use a separate 38px desktop / 29px mobile composition. These are task surfaces, not a marketing display type system.

## Layout

Desktop has a 224px navigation rail, reducing to 190px at 1080px. Main content has a 1216px outer maximum, including 48px side padding, leaving up to 1120px for the work. At 760px the rail becomes a horizontal navigation row, content padding becomes 22px, and paired columns stack.

Tables scroll inside their own containers. The mobile document remains viewport-width; navigation may scroll independently. Page sections use whitespace and rules rather than a grid of metric cards.

## Elevation & Depth

Tonal layers and thin borders establish depth. The dashboard does not use decorative shadows, glass, or gradients. Focus is a 3px outline with a 3px offset; it is an interaction cue, not elevation.

## Shapes

Controls use compact rounded corners. Sample and secret work areas use the larger radius. Small status badges use their own smaller radius. Inputs remain visibly bounded, with a stronger border on hover and focus.

## Components

Primary buttons name the next task. Secondary buttons handle loading samples and refreshing data. Buttons and inputs transition background and border color over 160ms; reduced motion removes those transitions.

Navigation combines consistent 18px stroke icons with labels. Selection uses the selected surface and dark emerald text. Mobile navigation preserves every destination through horizontal scrolling.

The playground uses one labeled textarea with one statement per line. The first nonblank line is compared with the remaining lines; blank lines are ignored. Line IDs preserve physical line numbers, and validation names oversized lines. Results show exact verdict codes, reasons, evidence identifiers, and an optional JSON inspector. Changing input invalidates the old result. A check locks its editor until completion.

Keys use a plain table and one-time secret panel. Creating another key waits until that panel is dismissed. Revocation expands an inline confirmation with Confirm revoke and Cancel actions. Usage remains a table of actual counters; unknown tokens and pending outcomes remain explicit. Administrator rollups separate channel, profile, requests, dispatches, completions, errors, and rejections.

## Do's and Don'ts

### Do

- Do connect verdicts to their submitted evidence IDs.
- Do keep account restrictions next to the task they prevent.
- Do preserve keyboard focus, live status, and readable contrast.
- Do keep synthetic examples labeled and require an explicit Run check.

### Don't

- Don't use decorative metric cards or fabricated charts.
- Don't collapse uncertainty into a successful clean result.
- Don't store keys, submitted text, or results in browser storage.
- Don't truncate input to make a check fit.
