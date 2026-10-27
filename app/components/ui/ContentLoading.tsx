/** Reserve space while a server section streams; never imply verified data. */
export function ContentLoading({ label = "Loading page" }: { label?: string }) {
  return <div className="content-loading" role="status" aria-live="polite" aria-busy="true">
    <span>{label}…</span>
    <div className="content-loading-lines" aria-hidden="true"><i /><i /><i /></div>
  </div>;
}
