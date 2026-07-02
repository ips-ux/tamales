import { Instagram, Mail, Phone } from "lucide-react";
import { useBusinessSettings } from "../lib/businessSettings";

export function AboutPage() {
  const business = useBusinessSettings();

  return (
    <main className="page-shell">
      <section className="split-section">
        <div>
          <p className="eyebrow">About Me</p>
          <h1>Family-style tamales with a sharper service flow.</h1>
          <p className="large-copy">
            Bangin Bustos Tamales is built around small-batch preorder windows, pop-up pickups,
            and direct owner confirmation. The food stays personal; the ordering stays clean.
          </p>
          <div className="contact-pills">
            <a href={`tel:${business.contactPhone}`}>
              <Phone size={17} />
              {business.contactPhone}
            </a>
            <a href={`mailto:${business.contactEmail}`}>
              <Mail size={17} />
              {business.contactEmail}
            </a>
            <a href={`https://instagram.com/${business.instagramHandle.replace("@", "")}`}>
              <Instagram size={17} />
              {business.instagramHandle}
            </a>
          </div>
        </div>
        <div className="about-image-frame">
          <img src="/media/tamales_hero.webp" alt="" />
        </div>
      </section>
    </main>
  );
}
