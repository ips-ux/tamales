import { describe, expect, it } from "vitest";
import {
  contactDisplayName,
  contactPhoneHref,
  contactReplyHref
} from "../src/components/admin/contactLinks";
import {
  DEFAULT_IMAGE_MAX_CHARS,
  compressionPasses,
  scaledSize
} from "../src/components/admin/imageCompression";
import {
  SITE_CONTENT_LIMITS,
  buildSiteContentValues,
  storedToFormValues
} from "../src/components/admin/siteContentForm";

describe("site content editor values", () => {
  it("shows an empty field for each value that is not stored", () => {
    const values = storedToFormValues({});
    expect(values.heroTagline).toBe("");
    expect(values.heroChips).toEqual(["", "", ""]);
    expect(values.howItWorks).toEqual([
      { title: "", text: "" },
      { title: "", text: "" },
      { title: "", text: "" }
    ]);
    expect(values.footerBlurb).toBe("");
    expect(storedToFormValues(undefined)).toEqual(values);
  });

  it("keeps stored text and ignores values of the wrong type", () => {
    const values = storedToFormValues({
      heroTagline: "Hot tamales.",
      heroChips: ["Red", 7],
      howItWorks: [{ title: "Pick" }, null, "bad"],
      refundPolicy: 12
    });
    expect(values.heroTagline).toBe("Hot tamales.");
    expect(values.heroChips).toEqual(["Red", "", ""]);
    expect(values.howItWorks[0]).toEqual({ title: "Pick", text: "" });
    expect(values.howItWorks[1]).toEqual({ title: "", text: "" });
    expect(values.howItWorks[2]).toEqual({ title: "", text: "" });
    expect(values.refundPolicy).toBe("");
  });

  it("saves an empty string for an empty field, so the site uses the default", () => {
    const form = storedToFormValues({});
    form.heroChips = ["  ", "Green chile ", ""];
    form.orderPolicy = " \n ";
    const saved = buildSiteContentValues(form);
    expect(saved.heroTagline).toBe("");
    expect(saved.heroChips).toEqual(["", "Green chile", ""]);
    expect(saved.orderPolicy).toBe("");
    expect(saved.howItWorks).toHaveLength(3);
  });

  it("keeps a blank line as the paragraph break in the About story", () => {
    const form = storedToFormValues({});
    form.aboutStory = "  One.\r\n\r\n\r\n  Two.  \n\n";
    expect(buildSiteContentValues(form).aboutStory).toBe("One.\n\nTwo.");
  });

  it("puts single-line fields on 1 line and cuts each field to its limit", () => {
    const form = storedToFormValues({});
    form.heroTagline = "Red and green\ntamales";
    form.heroChips = ["x".repeat(40), "", ""];
    form.aboutStory = "y".repeat(2500);
    form.howItWorks[0] = { title: "t".repeat(50), text: "s".repeat(200) };
    const saved = buildSiteContentValues(form);
    expect(saved.heroTagline).toBe("Red and green tamales");
    expect(saved.heroChips[0]).toHaveLength(SITE_CONTENT_LIMITS.heroChip);
    expect(saved.aboutStory).toHaveLength(SITE_CONTENT_LIMITS.aboutStory);
    expect(saved.howItWorks[0].title).toHaveLength(SITE_CONTENT_LIMITS.stepTitle);
    expect(saved.howItWorks[0].text).toHaveLength(SITE_CONTENT_LIMITS.stepText);
  });
});

describe("image compression passes", () => {
  it("keeps the 3 default passes for the default target", () => {
    expect(compressionPasses()).toHaveLength(3);
    expect(compressionPasses(DEFAULT_IMAGE_MAX_CHARS)).toEqual(compressionPasses());
    expect(compressionPasses()[0]).toEqual({ maxDimension: 1024, quality: 0.82 });
  });

  it("adds smaller passes for a smaller target, down to 480px at 0.5", () => {
    const passes = compressionPasses(250_000);
    expect(passes.length).toBeGreaterThan(3);
    expect(passes[passes.length - 1]).toEqual({ maxDimension: 480, quality: 0.5 });
    for (let index = 1; index < passes.length; index += 1) {
      expect(passes[index].maxDimension).toBeLessThanOrEqual(passes[index - 1].maxDimension);
      expect(passes[index].quality).toBeLessThanOrEqual(passes[index - 1].quality);
    }
  });

  it("scales to the longest side and does not make an image larger", () => {
    expect(scaledSize(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(scaledSize(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
    expect(scaledSize(300, 200, 1024)).toEqual({ width: 300, height: 200 });
  });
});

describe("contact message links", () => {
  it("builds a reply link with a Re: subject", () => {
    const href = contactReplyHref(" jane@example.com ");
    expect(href.startsWith("mailto:jane@example.com?subject=Re%3A%20")).toBe(true);
  });

  it("removes characters that can add a second mailto header", () => {
    expect(contactReplyHref("a@b.com?bcc=x@y.com")).toMatch(/^mailto:a@b\.combcc=x@y\.com\?subject=/);
  });

  it("builds a tel link from the digits, or nothing", () => {
    expect(contactPhoneHref("720-360-8688")).toBe("tel:7203608688");
    expect(contactPhoneHref("+1 (720) 360-8688")).toBe("tel:+17203608688");
    expect(contactPhoneHref("  ")).toBe("");
    expect(contactPhoneHref("n/a")).toBe("");
  });

  it("joins the name parts", () => {
    expect(contactDisplayName("Jane", " Doe ")).toBe("Jane Doe");
    expect(contactDisplayName("", "Doe")).toBe("Doe");
    expect(contactDisplayName("", "")).toBe("No name");
  });
});
