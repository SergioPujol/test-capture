import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { listActivity } from "../../services/activityService";
import type { ActivityItem, ActivitySeverity } from "../../types/activity";
import { formatDateTime } from "../../utils/format";

const toneBySeverity: Record<ActivitySeverity, "neutral" | "warning" | "danger"> = {
  info: "neutral",
  warning: "warning",
  critical: "danger",
};

export function ActivityTable() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ActivityItem | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listActivity(query)
      .then((result) => {
        if (active) setItems(result.items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query]);

  const criticalCount = useMemo(() => items.filter((item) => item.severity === "critical").length, [items]);

  return (
    <section className="panel">
      <div className="table-toolbar">
        <label className="search-box" htmlFor="activity-search">
          <Search size={16} />
          <input
            id="activity-search"
            data-testid="activity-search-input"
            placeholder="Search activity"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button data-testid="activity-filter-button" icon={<SlidersHorizontal size={16} />} onClick={() => setQuery("billing")}>
          Billing only
        </Button>
      </div>

      <div className="table-summary">
        <span>{loading ? "Loading activity" : `${items.length} events`}</span>
        <Badge tone={criticalCount > 0 ? "danger" : "success"}>{criticalCount} critical</Badge>
      </div>

      <div className="data-table" role="table" aria-label="Customer activity">
        <div className="data-table__row data-table__row--head" role="row">
          <span role="columnheader">Actor</span>
          <span role="columnheader">Action</span>
          <span role="columnheader">Severity</span>
          <span role="columnheader">Time</span>
          <span role="columnheader">Details</span>
        </div>
        {items.map((item) => (
          <div className="data-table__row" data-testid={`activity-row-${item.id}`} key={item.id} role="row">
            <span role="cell">{item.actor}</span>
            <span role="cell">{item.action}</span>
            <span role="cell"><Badge tone={toneBySeverity[item.severity]}>{item.severity}</Badge></span>
            <span role="cell">{formatDateTime(item.createdAt)}</span>
            <span role="cell">
              <Button data-testid={`open-activity-${item.id}`} onClick={() => setSelected(item)} variant="ghost">Open</Button>
            </span>
          </div>
        ))}
      </div>

      <div className="brittle-demo">
        <span className="decorative-dot" />
        <button type="button">Unnamed row action</button>
      </div>

      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.actor} activity` : "Activity"}
        onClose={() => setSelected(null)}
        onConfirm={() => setSelected(null)}
      >
        {selected ? (
          <div className="modal-detail">
            <p><strong>Action:</strong> {selected.action}</p>
            <p><strong>Target:</strong> {selected.target}</p>
            <p><strong>Recorded:</strong> {formatDateTime(selected.createdAt)}</p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
