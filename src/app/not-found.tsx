import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <h1 className="text-3xl">Nothing here.</h1>
      <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
        That page does not exist, or a share link was revoked.
      </p>
      <Link href="/" className="text-sm underline" style={{ color: 'var(--tl-text)' }}>
        Back to Home
      </Link>
    </div>
  );
}
