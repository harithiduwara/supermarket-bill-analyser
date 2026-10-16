import type { ReactNode } from "react";

/** The h1 is the focus target after navigation, so keyboard and screen-reader users land on the new page. */
export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
