import { ArrowRight, CalendarClock, MapPin, ShieldCheck } from "lucide-react";
import { navigate } from "../App";
import { availabilityWindows, menuProducts } from "../data/fixtures";
import { useBusinessSettings } from "../lib/businessSettings";
import { formatMoney } from "../lib/money";
import { formatWindow } from "../lib/time";

export function HomePage() {
  const businessSettings = useBusinessSettings();
  return (
    <main>
      <section className="hero-section">
        <img src="/media/tamales_hero.webp" alt="" className="hero-image" />
        <div className="hero-overlay" />
        <div className="hero-textile" aria-hidden="true" />
        <div className="hero-steam" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="hero-content">
          <div className="hero-kicker">
            <span aria-hidden="true" />
            <p className="eyebrow">Handmade in Colorado / Small-batch preorder</p>
          </div>
          <h1>
            <span>Bangin</span>
            <span>Bustos</span>
            <span>Tamales</span>
          </h1>
          <p>
            Red and green tamales built with serious masa, bold chile, and a pickup flow that
            keeps the batch organized from phone to pop-up.
          </p>
          <div className="hero-proof-row" aria-label="Batch highlights">
            <span>Red chile</span>
            <span>Green chile</span>
            <span>Owner confirmed</span>
          </div>
          <div className="hero-actions">
            <button className="button button-primary" type="button" onClick={() => navigate("/order")}>
              Place an Order
              <ArrowRight size={19} />
            </button>
            <button className="button button-ghost" type="button" onClick={() => navigate("/about")}>
              About Me
            </button>
          </div>
        </div>
        <div className="hero-batch-badge" aria-label="Next batch">
          <span>Next Batch</span>
          <strong>Saturday</strong>
          <small>10 AM - noon</small>
        </div>
        <div className="hero-info-strip">
          <div>
            <CalendarClock size={19} />
            <span>
              <strong>Pickup window</strong>
              {formatWindow(availabilityWindows[0])}
            </span>
          </div>
          <div>
            <MapPin size={19} />
            <span>
              <strong>Batch location</strong>
              {availabilityWindows[0].label}
            </span>
          </div>
          <div>
            <ShieldCheck size={19} />
            <span>
              <strong>Order policy</strong>
              Requests confirmed by owner
            </span>
          </div>
        </div>
      </section>

      <section className="section section-cream">
        <div className="section-heading">
          <p className="eyebrow">Current Batch</p>
          <h2>Built for red-or-green decisions.</h2>
        </div>
        <div className="menu-preview-grid">
          {menuProducts.map((product) => (
            <article className="menu-preview-card" key={product.id}>
              <img src={product.imageUrl} alt="" loading="lazy" />
              <div>
                <span className={`accent-dot accent-${product.spiceLevel}`} />
                <h3>{product.name}</h3>
                <p>{product.description}</p>
                <strong>{formatMoney(product.variants[0].priceCents)} half dozen</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section logistics-band">
        <div>
          <p className="eyebrow">How It Works</p>
          <h2>Clean preorder logistics for a moving pop-up.</h2>
        </div>
        <div className="logistics-grid">
          <article>
            <strong>1</strong>
            <h3>Pick a window</h3>
            <p>Choose from owner-configured pickup or event windows with capacity and cutoffs.</p>
          </article>
          <article>
            <strong>2</strong>
            <h3>Build the batch</h3>
            <p>Choose red, green, package sizes, quantities, and any bulk-order details.</p>
          </article>
          <article>
            <strong>3</strong>
            <h3>Wait for confirmation</h3>
            <p>{businessSettings.orderPolicy}</p>
          </article>
        </div>
      </section>
    </main>
  );
}
