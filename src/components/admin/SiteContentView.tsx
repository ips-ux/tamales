import { RotateCcw } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  SITE_IMAGE_MAX_CHARS,
  saveSiteContent,
  saveSiteImage,
  siteContentDefaults,
  siteImageIsCustom,
  useSiteImage,
  useStoredSiteContent,
  type SiteContent,
  type SiteImageSlot
} from "../../lib/siteContent";
import { ImagePicker } from "../ImagePicker";
import { SITE_CONTENT_LIMITS, buildSiteContentValues, storedToFormValues } from "./siteContentForm";

type Notice = { kind: "saved" | "error"; text: string } | null;

const stepNumbers = [0, 1, 2] as const;

/** Admin > Site Content. The owner edits the public text and the 2 photos. */
export function SiteContentView() {
  const stored = useStoredSiteContent();
  const [values, setValues] = useState<SiteContent>(() => storedToFormValues(stored));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const defaults = siteContentDefaults;
  const limits = SITE_CONTENT_LIMITS;

  // Load the stored values when they arrive. Do not replace text that the
  // owner is in the middle of an edit on.
  useEffect(() => {
    if (!dirty) setValues(storedToFormValues(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  function change(patch: Partial<SiteContent>) {
    setValues((current) => ({ ...current, ...patch }));
    setDirty(true);
    setNotice(null);
  }

  function changeChip(index: number, value: string) {
    const heroChips = [...values.heroChips] as SiteContent["heroChips"];
    heroChips[index] = value;
    change({ heroChips });
  }

  function changeStep(index: number, field: "title" | "text", value: string) {
    const howItWorks = values.howItWorks.map((step, position) =>
      position === index ? { ...step, [field]: value } : step
    ) as SiteContent["howItWorks"];
    change({ howItWorks });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = buildSiteContentValues(values);
    setSaving(true);
    setNotice(null);
    try {
      await saveSiteContent(next);
      setValues(next);
      setDirty(false);
      setNotice({ kind: "saved", text: "Saved. The site shows your changes now." });
    } catch {
      setNotice({
        kind: "error",
        text: "We could not save the site content. Check your connection, then try again."
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="site-content-form" onSubmit={handleSubmit}>
      <p className="muted site-content-lead">An empty field uses the default text.</p>

      <section className="admin-card site-content-card">
        <h2>Home page</h2>
        <SitePhotoField slot="hero" label="Hero photo" />
        <div className="form-grid">
          <label className="full-span">
            Hero tagline
            <textarea
              rows={3}
              maxLength={limits.heroTagline}
              value={values.heroTagline}
              placeholder={defaults.heroTagline}
              onChange={(event) => change({ heroTagline: event.target.value })}
            />
          </label>
          {stepNumbers.map((index) => (
            <label key={`chip-${index}`}>
              Hero chip {index + 1}
              <input
                type="text"
                maxLength={limits.heroChip}
                value={values.heroChips[index]}
                placeholder={defaults.heroChips[index]}
                onChange={(event) => changeChip(index, event.target.value)}
              />
            </label>
          ))}
        </div>
        <fieldset className="form-grid site-content-steps">
          <legend>How It Works</legend>
          {stepNumbers.map((index) => (
            <div className="site-content-step full-span" key={`step-${index}`}>
              <label>
                Step {index + 1} title
                <input
                  type="text"
                  maxLength={limits.stepTitle}
                  value={values.howItWorks[index].title}
                  placeholder={defaults.howItWorks[index].title}
                  onChange={(event) => changeStep(index, "title", event.target.value)}
                />
              </label>
              <label>
                Step {index + 1} text
                <input
                  type="text"
                  maxLength={limits.stepText}
                  value={values.howItWorks[index].text}
                  placeholder={defaults.howItWorks[index].text}
                  onChange={(event) => changeStep(index, "text", event.target.value)}
                />
              </label>
            </div>
          ))}
        </fieldset>
      </section>

      <section className="admin-card site-content-card">
        <h2>About page</h2>
        <SitePhotoField slot="about" label="About photo" />
        <div className="form-grid">
          <label className="full-span">
            About headline
            <input
              type="text"
              maxLength={limits.aboutHeadline}
              value={values.aboutHeadline}
              placeholder={defaults.aboutHeadline}
              onChange={(event) => change({ aboutHeadline: event.target.value })}
            />
          </label>
          <label className="full-span">
            About story
            <textarea
              rows={8}
              maxLength={limits.aboutStory}
              value={values.aboutStory}
              placeholder={defaults.aboutStory}
              aria-describedby="about-story-help"
              onChange={(event) => change({ aboutStory: event.target.value })}
            />
            <span className="site-content-help" id="about-story-help">
              Leave an empty line to start a new paragraph.
            </span>
          </label>
        </div>
      </section>

      <section className="admin-card site-content-card">
        <h2>Policies and footer</h2>
        <div className="form-grid">
          <label className="full-span">
            Order policy
            <textarea
              rows={3}
              maxLength={limits.policy}
              value={values.orderPolicy}
              placeholder={defaults.orderPolicy}
              onChange={(event) => change({ orderPolicy: event.target.value })}
            />
          </label>
          <label className="full-span">
            Payment policy
            <textarea
              rows={3}
              maxLength={limits.policy}
              value={values.paymentPolicy}
              placeholder={defaults.paymentPolicy}
              onChange={(event) => change({ paymentPolicy: event.target.value })}
            />
          </label>
          <label className="full-span">
            Refund policy
            <textarea
              rows={3}
              maxLength={limits.policy}
              value={values.refundPolicy}
              placeholder={defaults.refundPolicy}
              onChange={(event) => change({ refundPolicy: event.target.value })}
            />
          </label>
          <label className="full-span">
            Allergen notice
            <textarea
              rows={3}
              maxLength={limits.allergenNotice}
              value={values.allergenNotice}
              placeholder={defaults.allergenNotice}
              onChange={(event) => change({ allergenNotice: event.target.value })}
            />
          </label>
          <label className="full-span">
            Footer blurb
            <input
              type="text"
              maxLength={limits.footerBlurb}
              value={values.footerBlurb}
              placeholder={defaults.footerBlurb}
              onChange={(event) => change({ footerBlurb: event.target.value })}
            />
          </label>
        </div>
      </section>

      {notice && (
        <p
          className={notice.kind === "error" ? "form-notice form-notice-error" : "form-notice"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <div className="button-row">
        <button className="button button-primary" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Site Content"}
        </button>
      </div>
    </form>
  );
}

/** One photo slot. A photo saves when the owner selects it. */
function SitePhotoField({ slot, label }: { slot: SiteImageSlot; label: string }) {
  const image = useSiteImage(slot);
  const custom = siteImageIsCustom(slot);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function save(dataUrl: string) {
    setSaving(true);
    setNotice(null);
    try {
      await saveSiteImage(slot, dataUrl);
      setNotice({
        kind: "saved",
        text: dataUrl
          ? "Saved. The site shows the new photo now."
          : "Saved. The site shows the default photo now."
      });
    } catch {
      setNotice({
        kind: "error",
        text: "We could not save the photo. Check your connection, then try again."
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="site-content-photo">
      <ImagePicker
        label={label}
        value={image}
        maxChars={SITE_IMAGE_MAX_CHARS}
        disabled={saving}
        onChange={(dataUrl) => void save(dataUrl)}
      />
      <div className="image-picker-actions">
        <button
          className="button button-small"
          type="button"
          disabled={saving || !custom}
          onClick={() => void save("")}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Use Default Photo
        </button>
      </div>
      {notice && (
        <p
          className={notice.kind === "error" ? "form-notice form-notice-error" : "form-notice"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
