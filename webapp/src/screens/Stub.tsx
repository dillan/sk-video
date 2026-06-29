/** A placeholder for a cluster whose screens land in a later slice — honest about what's coming. */
export function Stub({ title, note }: { title: string; note: string }) {
  return (
    <>
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <div className="empty">
        <p>{title}</p>
        <p className="muted">{note}</p>
      </div>
    </>
  );
}
