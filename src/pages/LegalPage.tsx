export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const isPrivacy = kind === "privacy";
  return (
    <main className="page-shell narrow">
      <section className="legal-copy">
        <p className="eyebrow">{isPrivacy ? "Privacy" : "Terms"}</p>
        <h1>{isPrivacy ? "Privacy Notice" : "Ordering Terms"}</h1>
        <p>
          Bangin Bustos Tamales collects only the contact and order details needed to review,
          confirm, prepare, and fulfill preorder requests.
        </p>
        <h2>{isPrivacy ? "Information Collected" : "Order Requests"}</h2>
        <p>
          Customer names, phone numbers, email addresses, order details, notes, and pickup
          selections are stored for fulfillment and business recordkeeping. Order submissions are
          requests until the owner confirms them.
        </p>
        <h2>{isPrivacy ? "Retention" : "Payment"}</h2>
        <p>
          Completed orders, canceled orders, contact submissions, and logs should be retained only
          for the practical window needed for customer service, tax records, and abuse prevention.
          Payment is arranged after confirmation; this application does not store card data.
        </p>
      </section>
    </main>
  );
}
