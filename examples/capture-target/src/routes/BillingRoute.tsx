import { useState } from "react";
import { KeyRound, Send } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { TextAreaField, TextField } from "../components/ui/Field";
import { Toast, type ToastState } from "../components/ui/Toast";
import { hitPrivateEndpoint, loginForRedactionDemo } from "../services/customerService";

export function BillingRoute() {
  const [email, setEmail] = useState("admin@northstar.example");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [memo, setMemo] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pending, setPending] = useState(false);

  async function submitSensitiveFlow() {
    setPending(true);
    try {
      await loginForRedactionDemo({ email, password, accessToken });
      await hitPrivateEndpoint(accessToken || "demo-token-123");
      setToast({ tone: "success", message: "Sensitive flow completed" });
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Sensitive flow failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Billing settings" title="Privacy and form capture" />

      <section className="panel form-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Redaction scenario</p>
            <h2>Payment administrator access</h2>
          </div>
          <KeyRound size={22} />
        </div>

        <div className="form-grid">
          <TextField
            data-testid="billing-admin-email"
            label="Admin email"
            name="adminEmail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            data-testid="billing-password"
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            data-testid="billing-access-token"
            label="Access token"
            name="accessToken"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
          />
          <TextAreaField
            data-testid="billing-private-memo"
            label="Private billing memo"
            name="privateMemo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>

        <div className="form-actions">
          <Button data-testid="submit-sensitive-flow" disabled={pending} icon={<Send size={17} />} onClick={submitSensitiveFlow} variant="primary">
            {pending ? "Submitting" : "Submit sensitive flow"}
          </Button>
        </div>
      </section>

      <section className="panel testability-panel">
        <p className="eyebrow">Intentional testability issue</p>
        <h2>Unlabeled reimbursement code</h2>
        <p>This input intentionally lacks a label so Test Capture can flag weak accessibility metadata.</p>
        <input className="field__control" data-testid="unlabeled-reimbursement-code" placeholder="Reimbursement code" />
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
