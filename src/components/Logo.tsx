type Props = { taille?: number }

/** Marque StackMonster : une canette stylisée traversée d'un éclair, posée sur une pile. */
export default function Logo({ taille = 30 }: Props) {
  return (
    <svg
      className="logo-mark"
      width={taille}
      height={taille}
      viewBox="0 0 28 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="6" y="3" width="16" height="21" rx="4" fill="#20241B" stroke="#9EE818" strokeWidth="1.4" />
      <ellipse cx="14" cy="3" rx="8" ry="1.6" fill="#171A14" stroke="#9EE818" strokeWidth="1.2" />
      <path d="M16.5 7 L10.5 15.5 H14 L11.5 21 L19 12.5 H15 Z" fill="#9EE818" />
      <rect x="2" y="27" width="24" height="2.4" rx="1.2" fill="#2A3020" />
      <rect x="4.5" y="30.4" width="19" height="1.8" rx="0.9" fill="#20241B" />
    </svg>
  )
}
