import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

type ModalProps = {
  title: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function Modal({ title, children, open, onClose, onConfirm }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="modal" role="dialog">
        <header className="modal__header">
          <h2>{title}</h2>
          <button aria-label="Close modal" className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        <footer className="modal__actions">
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button data-testid="confirm-modal-action" onClick={onConfirm} variant="primary">Confirm</Button>
        </footer>
      </section>
    </div>
  );
}
