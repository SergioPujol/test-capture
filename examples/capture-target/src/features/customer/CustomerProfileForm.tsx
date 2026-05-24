import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextAreaField, TextField } from "../../components/ui/Field";
import { Toast, type ToastState } from "../../components/ui/Toast";
import { getCustomer, updateCustomer } from "../../services/customerService";
import type { Customer, CustomerPlan, CustomerUpdate } from "../../types/customer";

const planLabels: Record<CustomerPlan, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

export function CustomerProfileForm() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<CustomerUpdate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let active = true;
    getCustomer()
      .then((result) => {
        if (!active) return;
        setCustomer(result);
        setDraft({ billingEmail: result.billingEmail, plan: result.plan, notes: result.notes });
      })
      .catch((error) => setToast({ tone: "danger", message: error instanceof Error ? error.message : "Could not load customer" }))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function saveProfile() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await updateCustomer(draft);
      setCustomer(result);
      setDraft({ billingEmail: result.billingEmail, plan: result.plan, notes: result.notes });
      setToast({ tone: "success", message: `Billing email saved as ${result.billingEmail}` });
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="panel">Loading customer...</div>;
  if (!customer || !draft) return <div className="panel">Customer unavailable.</div>;

  return (
    <section className="panel form-panel" aria-labelledby="customer-form-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Account {customer.id}</p>
          <h2 id="customer-form-title">{customer.name}</h2>
        </div>
        <span className="status-pill">{customer.status}</span>
      </div>

      <div className="form-grid">
        <TextField
          data-testid="billing-email-input"
          label="Billing email"
          name="billingEmail"
          type="email"
          value={draft.billingEmail}
          onChange={(event) => setDraft((current) => current && { ...current, billingEmail: event.target.value })}
        />
        <SelectField
          data-testid="plan-select"
          label="Plan"
          name="plan"
          value={draft.plan}
          onChange={(event) => setDraft((current) => current && { ...current, plan: event.target.value as CustomerPlan })}
        >
          {Object.entries(planLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>
        <TextAreaField
          data-testid="account-notes-input"
          label="Account notes"
          name="notes"
          value={draft.notes}
          onChange={(event) => setDraft((current) => current && { ...current, notes: event.target.value })}
        />
      </div>

      <div className="form-actions">
        <Button data-testid="save-customer-button" disabled={saving} icon={<Save size={17} />} onClick={saveProfile} variant="primary">
          {saving ? "Saving" : "Save profile"}
        </Button>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
