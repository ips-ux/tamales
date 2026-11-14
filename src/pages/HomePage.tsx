import { ArrowRight, CalendarClock } from "lucide-react";
import { quantityLabel } from "../components/publicForm";
import { SiteLink } from "../components/SiteFooter";
import { useAvailabilityWindows } from "../lib/availabilityStore";
import { useMenuProducts } from "../lib/menuStore";
import { formatMoney } from "../lib/money";
import { useSiteContent, useSiteImage } from "../lib/siteContent";
import { formatWindow, isWindowSelectable, nextUpcomingEvent } from "../lib/time";

export function HomePage() {
  const content = useSiteContent();
  const heroPhoto = useSiteImage("hero");
  const menuProducts = useMenuProducts().filter((product) => product.status !== "inactive");
  const availabilityWindows = useAvailabilityWindows();
  const nextEvent = nextUpcomingEvent(availabilityWindows);
  const preorderOpen = nextEvent ? isWindowSelectable(nextEvent) : false;

  return (
    <main>
      <section className="hero-section">
        <img src={heroPhoto} alt="" className="hero-image" />
        <div className="hero-overlay" />
        <div className="hero-textile" aria-hidden="true" />
        <div className="hero-steam" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="hero-content">
          <h1 className="sr-only">Bangin Bustos Tamales</h1>
          <div className="hero-logo-card">
            <img className="hero-logo-img" src="/media/logosticker.webp" alt="Bangin Bustos Tamales" />
          </div>
          <p>{content.heroTagline}</p>
          <div className="hero-proof-row">
            {content.heroChips.map((chip, index) => (
              <span key={index}>{chip}</span>
            ))}
          </div>
          <div className="hero-actions">
            <SiteLink className="button button-ghost" href="/about">
              Read Our Story
            </SiteLink>
            <SiteLink className="button button-primary" href="/order">
              Place an Order
              <ArrowRight size={19} aria-hidden="true" />
            </SiteLink>
          </div>
        </div>
        <div className="hero-info-strip hero-next-event">
          <div>
            <CalendarClock size={19} aria-hidden="true" />
            <span>
              <strong>{preorderOpen ? "Pre-orders are open" : "Next event"}</strong>
              {nextEvent
                ? `${nextEvent.label}. ${formatWindow(nextEvent)}`
                : "No events are on the calendar. Check back soon."}
            </span>
          </div>
        </div>
      </section>

      <section className="section section-cream">
        <div className="section-heading">
          <h2>Red, green, or both.</h2>
        </div>
        <div className="menu-preview-grid">
          {menuProducts.map((product) => {
            const firstVariant = product.variants[0];
            return (
              <article className="menu-preview-card" key={product.id}>
                <img src={product.imageUrl} alt="" loading="lazy" />
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  {product.status === "sold_out" ? (
                    <span className="status-badge product-status-sold_out">Sold out</span>
                  ) : (
                    firstVariant && (
                      <strong>
                        {quantityLabel(firstVariant.unitQuantity)} for {formatMoney(firstVariant.priceCents)}
                      </strong>
                    )
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="allergen-notice">
          <strong>Allergen notice.</strong> {content.allergenNotice}
        </p>
      </section>

      <section className="section logistics-band">
        <div>
          <h2>How It Works</h2>
        </div>
        <div className="logistics-grid">
          {content.howItWorks.map((item, index) => (
            <article key={index}>
              <strong>{index + 1}</strong>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
