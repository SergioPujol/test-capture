import { PageHeader } from "../components/layout/PageHeader";
import { ErrorLabPanel } from "../features/error-lab/ErrorLabPanel";

export function ErrorLabRoute() {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Diagnostics" title="Network and console lab" />
      <ErrorLabPanel />
    </div>
  );
}
