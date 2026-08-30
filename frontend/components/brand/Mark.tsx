/**
 * The Obscyro mark: two rings of the same radius, offset so they overlap.
 *
 * Geometry is lifted from the supplied artwork rather than redrawn by eye. In
 * the original 375-unit artboard the rings sit at cx 151.86 and 223.13, cy 170,
 * r 106.89, stroke 37.5, and the second ring carries 73% opacity. Those numbers
 * are preserved here, translated into a tight viewBox so the mark can be
 * dropped anywhere without stray padding:
 *
 *   A (125.64, 125.64)   B (196.91, 125.64)   r 106.89   stroke 37.5
 *
 * The overlap is the whole point and it is used as such across the site: two
 * bodies of data that are not the same shape, meeting in a region that belongs
 * to both. Nothing else in the identity has to carry that idea.
 */

export const MARK_VIEWBOX = "0 0 322.55 251.28";

export interface MarkProps {
  className?: string;
  /** Stroke colour. Defaults to the current text colour. */
  color?: string;
  /** Opacity of the trailing ring. The artwork uses 0.73. */
  trailOpacity?: number;
  title?: string;
}

export default function Mark({
  className,
  color = "currentColor",
  trailOpacity = 0.73,
  title,
}: MarkProps) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={className}
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="125.64" cy="125.64" r="106.89" stroke={color} strokeWidth="37.5" />
      <circle
        cx="196.91"
        cy="125.64"
        r="106.89"
        stroke={color}
        strokeWidth="37.5"
        opacity={trailOpacity}
      />
    </svg>
  );
}
