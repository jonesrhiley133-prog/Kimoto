import { Link } from 'react-router-dom';

export default function Misc({ page }: { page: 'guidelines' | '404' }) {
  if (page === '404') {
    return (
      <div className="text-center py-24">
        <p className="font-display text-6xl font-bold text-primary">404</p>
        <h1 className="text-xl font-semibold mt-3">This page wandered off</h1>
        <p className="text-muted mt-2">The link may be broken, or the page was removed.</p>
        <Link to="/" className="btn-primary mt-6">Back home</Link>
      </div>
    );
  }
  return (
    <article className="max-w-2xl mx-auto prose-sm">
      <h1 className="font-display text-3xl font-bold mb-4">Community guidelines</h1>
      <p className="text-muted mb-6">Kimoto is a place to share the stories we love. These rules keep it welcoming.</p>
      {[
        ['Be kind', 'Disagree with ideas, not people. No harassment, bullying, threats or hate speech based on identity.'],
        ['Tag spoilers', 'Use the spoiler checkbox or wrap text in ||double bars||. Chapter comments may discuss that chapter, but mark anything beyond it.'],
        ['Keep it on topic', 'Chapter talk belongs in chapter comments; broader discussion goes in title discussions.'],
        ['No spam or self-promotion', 'No repeated posts, link farming, or advertising. New accounts are limited to one link per post on their first day.'],
        ['Respect creators', "Don't share links to pirated content. Support official releases where they exist."],
        ['Keep it appropriate', 'No sexual content involving minors, no graphic gore outside appropriately-rated titles, and no doxxing.'],
        ['Use reports', 'Report content that breaks these rules — moderators review every report. Content reported by several people is hidden until reviewed.'],
      ].map(([h, b]) => (
        <section key={h} className="mb-5"><h2 className="font-semibold text-lg">{h}</h2><p className="text-fg/90 mt-1">{b}</p></section>
      ))}
      <p className="text-sm text-muted">Moderators may remove content, issue warnings, or suspend accounts that break these rules. Actions are recorded in an audit log.</p>
    </article>
  );
}
