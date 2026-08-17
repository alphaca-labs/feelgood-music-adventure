import Link from "next/link";

// Exported as out/404.html, which GitHub Pages serves for unknown paths.
const NotFound = () => (
  <main className="app">
    <section className="scene scene-title">
      <div className="title-field">
        <p className="venue-code">404 · OFF THE SETLIST</p>
        <p className="title-deck">이 무대는 존재하지 않아요.</p>
      </div>
      <div className="title-action">
        <Link className="primary-button" href="/">
          <span>무대로 돌아가기</span>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  </main>
);

export default NotFound;
