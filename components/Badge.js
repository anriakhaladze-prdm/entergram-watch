// The design system's badge: colour on the inner span, so the text carries the
// hue whatever the surrounding text colour is.
export default function Badge({ tone = 'gray', children }) {
  return <span className={`th-badge th-badge-${tone}`}><span className="typ-label-small">{children}</span></span>;
}
