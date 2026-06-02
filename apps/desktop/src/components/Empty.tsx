import type { EmptySize, EmptyVariant } from "../app/model";

export function Empty(input: {
  title: string;
  description?: string;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";

  return (
    <section className={`slei-empty slei-empty--${variant} slei-empty--${size}${input.centered ? " slei-empty-detail" : ""}`} role="status">
      <div className="slei-empty__pixel-face" aria-hidden="true">
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--left" />
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--right" />
        <span className="slei-empty__pixel slei-empty__pixel--mouth" />
        <span className="slei-empty__pixel slei-empty__pixel--mark" />
      </div>
      <div className="slei-empty__copy">
        <h2>{input.title}</h2>
        {input.description ? <p>{input.description}</p> : null}
      </div>
    </section>
  );
}
