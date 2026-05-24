import { PageHeader } from "../components/layout/PageHeader";
import { ActivityTable } from "../features/activity/ActivityTable";

export function ActivityRoute() {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Activity log" title="Searchable customer events" />
      <ActivityTable />
    </div>
  );
}
