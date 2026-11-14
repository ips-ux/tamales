import { SiteLink } from "../components/SiteFooter";

export function NotFoundPage() {
  return (
    <main className="page-shell narrow">
      <section className="empty-state not-found">
        <h1>Page not found.</h1>
        <p>We do not have a page at this link.</p>
        <SiteLink className="button button-primary" href="/">
          Back to Home
        </SiteLink>
      </section>
    </main>
  );
}
