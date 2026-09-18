import { CatShapes, CAT } from "@/components/cat-mark";

/**
 * The cover-page illustration: the cat from the brand mark asleep on its
 * cushion on a windowsill, with two small product moments floating beside
 * it — a rent payment landing and a lease getting signed. The point of the
 * picture is the mood (nothing needs you right now); the chips are there so
 * the mood is about *this* product and not a pet shop.
 *
 * Drawn inline so it follows the theme. Anything that is "the room" — the
 * window frame, the sky, the chips — takes its colour from the same tokens
 * the page uses, so at night the window shows a night sky and the chips sit
 * on the dark surface colour. The cat and cushion are illustration colours
 * and stay the same (see CAT in cat-mark.tsx).
 *
 * All flat shapes, no gradients or filters: the app's one-accent, no-gradient
 * rule (globals.css) applies to the picture too, and it's also what keeps the
 * scene reading as one object rather than a stock illustration pasted in.
 */
export function HeroScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 400"
      className={className}
      role="img"
      aria-label="A cat asleep on a cushion on a windowsill. Beside it, a card says a rent payment was received and another says a lease was signed."
    >
      {/* window: frame, then sky, then the cross-bars over the sky */}
      <rect x="96" y="16" width="288" height="244" rx="22" fill="var(--scene-frame)" />
      <rect x="112" y="32" width="256" height="212" rx="12" fill="var(--scene-sky)" />
      {/* sun by day, moon by night — same circle, different token */}
      <circle cx="318" cy="88" r="26" fill="var(--scene-sun)" />
      {/* a soft distant hill so the sky isn't a flat plate */}
      <path d="M112 200c50-38 100-44 150-20s70 30 106 8v56H112z" fill="var(--scene-hill)" />
      <rect x="236" y="32" width="8" height="212" fill="var(--scene-frame)" />
      <rect x="112" y="134" width="256" height="8" fill="var(--scene-frame)" />

      {/* sill */}
      <rect x="72" y="258" width="336" height="22" rx="6" fill="var(--scene-sill)" />
      <rect x="84" y="280" width="312" height="8" rx="4" fill="var(--scene-sill-shadow)" />

      {/* plant, on the right end of the sill */}
      <g>
        <path d="M352 258h30l-4-30h-22z" fill="#c98a5a" />
        <path d="M367 232c-14-10-20-26-14-40 12 4 20 18 18 34" fill="#7fa07a" />
        <path d="M367 232c14-14 16-30 8-44-12 6-18 22-14 38" fill="#8fb08a" />
        <path d="M367 236c-2-16 4-30 16-36 2 14-4 28-14 36" fill="#6f9070" />
      </g>

      {/* the cat, from the mark, scaled up to sit on the sill */}
      <g transform="translate(150 118) scale(4.6)">
        <CatShapes />
      </g>

      {/* z z z — rising from the cat's head, up into the left pane. Text
          inherits the page font. */}
      <g
        fill={CAT.cushion}
        fontFamily="inherit"
        fontWeight="800"
        style={{ opacity: 0.9 }}
      >
        <text x="150" y="132" fontSize="18">
          z
        </text>
        <text x="164" y="110" fontSize="24">
          z
        </text>
        <text x="184" y="84" fontSize="30">
          z
        </text>
      </g>

      {/* chips, level with each other, under the sill */}
      {/* chip: rent received */}
      <g transform="translate(20 312)">
        <rect width="212" height="64" rx="14" fill="var(--surface)" stroke="var(--neutral-200)" />
        <circle cx="32" cy="32" r="14" fill={CAT.cushion} />
        <path
          d="M25.5 32.5l4.5 4.5 9-9"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="58" y="28" fontFamily="inherit" fontSize="14" fontWeight="700" fill="var(--neutral-900)">
          Rent received
        </text>
        <text x="58" y="47" fontFamily="inherit" fontSize="12.5" fill="var(--neutral-500)">
          Unit 2B · $1,450 · matched
        </text>
      </g>

      {/* chip: lease signed */}
      <g transform="translate(264 312)">
        <rect width="196" height="64" rx="14" fill="var(--surface)" stroke="var(--neutral-200)" />
        <rect x="18" y="18" width="28" height="28" rx="8" fill="var(--scene-frame)" />
        <path
          d="M24 28h16M24 34h10"
          stroke="var(--neutral-400)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M27 40c3-4 5 2 8-2s4 0 7-3"
          fill="none"
          stroke={CAT.fur}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text x="58" y="28" fontFamily="inherit" fontSize="14" fontWeight="700" fill="var(--neutral-900)">
          Lease signed
        </text>
        <text x="58" y="47" fontFamily="inherit" fontSize="12.5" fill="var(--neutral-500)">
          12 Oak St · both parties
        </text>
      </g>
    </svg>
  );
}
