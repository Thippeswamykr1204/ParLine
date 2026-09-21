export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#12244A" />
      <path d="M9.5 7.5h13l-1.9 16a3 3 0 0 1-3 2.6h-3.2a3 3 0 0 1-3-2.6l-1.9-16Z" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5.5 17h21" stroke="#F2A20C" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
