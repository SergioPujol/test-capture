import { useState } from "react";
import { AlertOctagon, Bug, Clock, Terminal } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Toast, type ToastState } from "../../components/ui/Toast";
import { triggerFailedRequest, triggerSlowRequest } from "../../services/diagnosticService";

export function ErrorLabPanel() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function warnInConsole() {
    console.warn("Synthetic warning from Capture Target", { area: "error-lab" });
    setToast({ tone: "warning", message: "Console warning emitted" });
  }

  function errorInConsole() {
    console.error("Synthetic error from Capture Target", { code: "CAPTURE_TARGET_ERROR" });
    setToast({ tone: "danger", message: "Console error emitted" });
  }

  async function runSlowRequest() {
    setPending("slow");
    try {
      const result = await triggerSlowRequest();
      setToast({ tone: "success", message: `Slow request completed in ${result.delayMs}ms` });
    } finally {
      setPending(null);
    }
  }

  async function runFailedRequest() {
    setPending("fail");
    try {
      await triggerFailedRequest();
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Failed request captured" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel error-grid">
      <Button data-testid="trigger-console-warning" icon={<Terminal size={17} />} onClick={warnInConsole}>
        Console warning
      </Button>
      <Button data-testid="trigger-console-error" icon={<Bug size={17} />} onClick={errorInConsole} variant="danger">
        Console error
      </Button>
      <Button data-testid="trigger-slow-request" disabled={pending === "slow"} icon={<Clock size={17} />} onClick={runSlowRequest}>
        {pending === "slow" ? "Waiting" : "Slow request"}
      </Button>
      <Button data-testid="trigger-failed-request" disabled={pending === "fail"} icon={<AlertOctagon size={17} />} onClick={runFailedRequest} variant="danger">
        {pending === "fail" ? "Failing" : "Failed request"}
      </Button>

      <div className="nameless-action">
        <button type="button" onClick={() => setToast({ tone: "warning", message: "This nameless button is intentionally hard to select" })} />
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
