import type { HoldingTransaction } from "../../types";

export type LedgerDeleteModalProps = {
  target: HoldingTransaction | null;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  formatMoney: (value: number | null, currency?: string) => string;
};

export function LedgerDeleteModal(props: LedgerDeleteModalProps) {
  if (!props.target) {
    return null;
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Delete this transaction?</h3>
          <button className="ghost" onClick={props.onCancel}>
            Close
          </button>
        </div>
        <p>
          {props.target.type} · {props.target.trade_date.slice(0, 10)} · {props.target.quantity}
          {props.target.price === null
            ? ""
            : ` @ ${props.formatMoney(props.target.price, props.target.currency)}`}
        </p>
        {props.error && <p className="error">{props.error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={props.onCancel} disabled={props.loading}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={props.onConfirm} disabled={props.loading}>
            {props.loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
