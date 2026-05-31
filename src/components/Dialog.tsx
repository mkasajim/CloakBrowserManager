import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

export type DialogState = {
  type: "alert" | "confirm";
  severity: "info" | "warn" | "error";
  title: string;
  message: string;
  resolve: (value: boolean) => void;
};

export function Dialog({ dialog, onClose }: { dialog: DialogState; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal dialog-modal ${dialog.severity}`}>
        <div className="dialog-content">
          <div className={`dialog-icon ${dialog.severity}`}>
            {dialog.severity === "error" && <AlertTriangle size={24} />}
            {dialog.severity === "warn" && <AlertTriangle size={24} />}
            {dialog.severity === "info" &&
              (dialog.type === "confirm" ? <HelpCircle size={24} /> : <CheckCircle2 size={24} />)}
          </div>
          <div className="dialog-text">
            <div className="dialog-title">{dialog.title}</div>
            <div className="dialog-message">{dialog.message}</div>
          </div>
        </div>
        <div className="dialog-footer">
          {dialog.type === "confirm" && (
            <button
              type="button"
              onClick={() => {
                dialog.resolve(false);
                onClose();
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => {
              dialog.resolve(true);
              onClose();
            }}
          >
            {dialog.type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
