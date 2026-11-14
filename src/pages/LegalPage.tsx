import { SiteLink } from "../components/SiteFooter";
import { useBusinessSettings } from "../lib/businessSettings";
import { useSiteContent } from "../lib/siteContent";

function PrivacyCopy({ email }: { email: string }) {
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return (
    <section className="legal-copy">
      <h1>Privacy</h1>
      <p>
        Bangin Bustos Tamales collects only the data that we need to take your order, make it, and
        give it to you. We do not sell your data.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your name, email address, and phone number.</li>
        <li>The details of your order.</li>
        <li>Your delivery address, if you ask for delivery.</li>
        <li>The messages that you send with the Contact form.</li>
      </ul>
      <p>
        We use this data to confirm your order, to prepare it, to contact you about it, and to keep
        business records. We do not store card numbers.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>Google Firebase stores orders and contact data.</li>
        <li>Cloudflare operates the forms on this site and the check that stops automated use.</li>
        <li>Resend sends our email.</li>
        <li>PayPal processes payments.</li>
      </ul>

      <h2>Your choices</h2>
      <p>
        We add you to the email list only if you sign up. To leave the email list, reply to an
        email from us or write to {mail}.
      </p>
      <p>
        To ask us to delete your data, write to {mail}. We keep the order records that we need for
        tax records.
      </p>
    </section>
  );
}

function TermsCopy() {
  const content = useSiteContent();
  return (
    <section className="legal-copy">
      <h1>Terms</h1>
      <p>These terms apply to each order that you place with Bangin Bustos Tamales.</p>

      <h2>Orders</h2>
      <p>{content.orderPolicy}</p>
      <p>
        For some events, we sell a fixed quantity of tamales. Those pre-orders stay open until the
        tamales are sold out. We can decline an order.
      </p>

      <h2>Payment and refunds</h2>
      <p>{content.paymentPolicy}</p>
      <p>We cancel an approved order if we do not receive payment in time.</p>
      <p>{content.refundPolicy}</p>

      <h2>Pickup and delivery</h2>
      <p>
        Pick up your order at the pickup area at the time on your order. We send the pickup details
        by email.
      </p>
      <p>
        We deliver batch requests in a limited area. We show the delivery fee before you pay.
      </p>

      <h2>Allergen notice</h2>
      <p>{content.allergenNotice}</p>

      <p className="legal-contact">
        Do you have a question about an order? <SiteLink href="/contact">Send us a message.</SiteLink>
      </p>
    </section>
  );
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const business = useBusinessSettings();
  return (
    <main className="page-shell narrow">
      {kind === "privacy" ? <PrivacyCopy email={business.contactEmail} /> : <TermsCopy />}
    </main>
  );
}
