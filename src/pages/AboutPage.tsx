import { Instagram, Mail, Phone } from "lucide-react";
import { formatPhone, phoneHref, splitParagraphs } from "../components/publicForm";
import { useBusinessSettings } from "../lib/businessSettings";
import { useSiteContent, useSiteImage } from "../lib/siteContent";

export function AboutPage() {
  const business = useBusinessSettings();
  const content = useSiteContent();
  const photo = useSiteImage("about");
  const paragraphs = splitParagraphs(content.aboutStory);

  return (
    <main className="page-shell">
      <section className="split-section">
        <div>
          <h1>{content.aboutHeadline}</h1>
          {paragraphs.map((paragraph, index) => (
            <p className={index === 0 ? "large-copy" : "about-story"} key={index}>
              {paragraph}
            </p>
          ))}
          <div className="contact-pills">
            <a href={phoneHref(business.contactPhone)}>
              <Phone size={17} aria-hidden="true" />
              {formatPhone(business.contactPhone)}
            </a>
            <a href={`mailto:${business.contactEmail}`}>
              <Mail size={17} aria-hidden="true" />
              {business.contactEmail}
            </a>
            {/* Placeholder until the owner supplies an Instagram handle. Do not hide this link. */}
            <a href="#">
              <Instagram size={17} aria-hidden="true" />
              Instagram
            </a>
          </div>
        </div>
        <div className="about-image-frame">
          <img src={photo} alt="" />
        </div>
      </section>
    </main>
  );
}
