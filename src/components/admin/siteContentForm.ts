// Pure helpers for the Site Content editor (Admin > Site Content).
// No React and no Firebase here, so the tests can import this file directly.

import type { HowItWorksStep, SiteContent } from "../../lib/siteContent";

/** Maximum length of each editable field, in characters. */
export const SITE_CONTENT_LIMITS = {
  heroTagline: 160,
  heroChip: 24,
  aboutHeadline: 60,
  aboutStory: 2000,
  stepTitle: 30,
  stepText: 120,
  policy: 400,
  allergenNotice: 400,
  footerBlurb: 120
} as const;

function raw(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Turns the stored document into editor values. A missing field becomes an
 * empty string, so the editor shows the default as the placeholder.
 */
export function storedToFormValues(stored: Record<string, unknown> | undefined): SiteContent {
  const source = stored ?? {};
  const chips = Array.isArray(source.heroChips) ? source.heroChips : [];
  const steps = Array.isArray(source.howItWorks) ? source.howItWorks : [];
  const step = (index: number): HowItWorksStep => {
    const item = (steps[index] ?? {}) as Record<string, unknown>;
    return { title: raw(item?.title), text: raw(item?.text) };
  };
  return {
    heroTagline: raw(source.heroTagline),
    heroChips: [raw(chips[0]), raw(chips[1]), raw(chips[2])],
    aboutHeadline: raw(source.aboutHeadline),
    aboutStory: raw(source.aboutStory),
    howItWorks: [step(0), step(1), step(2)],
    orderPolicy: raw(source.orderPolicy),
    paymentPolicy: raw(source.paymentPolicy),
    refundPolicy: raw(source.refundPolicy),
    allergenNotice: raw(source.allergenNotice),
    footerBlurb: raw(source.footerBlurb)
  };
}

/** One line of text: no line breaks, no space at the ends, cut to the limit. */
function line(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Text with paragraphs: a blank line stays as the paragraph break. */
function paragraphs(value: string, max: number): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, max)
    .trim();
}

/**
 * Builds the object that the editor saves. An empty string means "use the
 * default" (lib/siteContent.ts applies the default when it reads the value).
 */
export function buildSiteContentValues(form: SiteContent): SiteContent {
  const limits = SITE_CONTENT_LIMITS;
  const step = (index: number): HowItWorksStep => ({
    title: line(form.howItWorks[index].title, limits.stepTitle),
    text: line(form.howItWorks[index].text, limits.stepText)
  });
  return {
    heroTagline: line(form.heroTagline, limits.heroTagline),
    heroChips: [
      line(form.heroChips[0], limits.heroChip),
      line(form.heroChips[1], limits.heroChip),
      line(form.heroChips[2], limits.heroChip)
    ],
    aboutHeadline: line(form.aboutHeadline, limits.aboutHeadline),
    aboutStory: paragraphs(form.aboutStory, limits.aboutStory),
    howItWorks: [step(0), step(1), step(2)],
    orderPolicy: line(form.orderPolicy, limits.policy),
    paymentPolicy: line(form.paymentPolicy, limits.policy),
    refundPolicy: line(form.refundPolicy, limits.policy),
    allergenNotice: line(form.allergenNotice, limits.allergenNotice),
    footerBlurb: line(form.footerBlurb, limits.footerBlurb)
  };
}
