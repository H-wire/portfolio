export type SeedPositionModalProps = {
  open: boolean;
  seedListingId: string;
  seedListingLocked: boolean;
  seedQuantity: string;
  seedAvgCost: string;
  seedCurrency: string;
  seedFirstBuyDate: string;
  seedNotes: string;
  seedError: string | null;
  seedSaving: boolean;
  onClose: () => void;
  onSeedListingIdChange: (value: string) => void;
  onSeedQuantityChange: (value: string) => void;
  onSeedAvgCostChange: (value: string) => void;
  onSeedCurrencyChange: (value: string) => void;
  onSeedFirstBuyDateChange: (value: string) => void;
  onSeedNotesChange: (value: string) => void;
  onSave: () => void;
};

export function SeedPositionModal(props: SeedPositionModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal" onClick={props.onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{props.seedListingId ? "Edit Position" : "Seed Position"}</h3>
          <button className="ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="strategy-form">
          <label>
            Listing ID
            <input
              value={props.seedListingId}
              onChange={(event) => props.onSeedListingIdChange(event.target.value)}
              disabled={props.seedListingLocked}
            />
          </label>
          <label>
            Quantity
            <input value={props.seedQuantity} onChange={(event) => props.onSeedQuantityChange(event.target.value)} />
          </label>
          <label>
            Average cost (GAV)
            <input value={props.seedAvgCost} onChange={(event) => props.onSeedAvgCostChange(event.target.value)} />
          </label>
          <label>
            Cost currency
            <input value={props.seedCurrency} onChange={(event) => props.onSeedCurrencyChange(event.target.value)} />
          </label>
          <label>
            First buy date
            <input value={props.seedFirstBuyDate} onChange={(event) => props.onSeedFirstBuyDateChange(event.target.value)} />
          </label>
          <label>
            Notes
            <textarea rows={3} value={props.seedNotes} onChange={(event) => props.onSeedNotesChange(event.target.value)} />
          </label>
          {props.seedError && <p className="error">{props.seedError}</p>}
          <button onClick={props.onSave} disabled={props.seedSaving}>
            {props.seedSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
