import { X } from "lucide-react";

export type ToastState = {
  tone: "success" | "warning" | "danger";
  message: string;
};

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.tone}`} data-testid="toast-message" role="status">
      <span>{toast.message}</span>
      <button aria-label="Dismiss notification" className="icon-button" type="button" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
