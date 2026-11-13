/** Anti VPN mark (concept A, "Tunnel A") – drawn in currentColor so it follows the theme. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-label="Anti VPN">
      <path fill="currentColor" d="M106 30H150L230 226H166V190A38 38 0 0 0 90 190V226H26Z" />
    </svg>
  );
}
