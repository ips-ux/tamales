import { Instagram, Phone } from "lucide-react";
import { businessSettings } from "../data/fixtures";

export function AboutPage() {
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
            <a href={`tel:${businessSettings.contactPhone}`}>
              <Phone size={17} />
              {businessSettings.contactPhone}
            </a>
            <a href={`https://instagram.com/${businessSettings.instagramHandle.replace("@", "")}`}>
              <Instagram size={17} />
              {businessSettings.instagramHandle}
            </a>
          </div>
        </div>
        <div className="about-image-frame">
          <img src="/media/tamales_hero.png" alt="" />
        </div>
      </section>
    </main>
  );
}
