export type AllocationBucket = {
  label: string;
  weight: number;
};

export type AllocationCardProps = {
  allocationView: "sector" | "currency" | "country";
  onAllocationViewChange: (value: "sector" | "currency" | "country") => void;
  allocationBuckets: AllocationBucket[];
  loading: boolean;
  topAllocationWeight: number;
  formatPercent: (value: number) => string;
};

export function AllocationCard(props: AllocationCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>Allocation</h3>
        {props.topAllocationWeight > 0.6 && (
          <span className="warning" title="Top allocation exceeds 60%">
            ⚠
          </span>
        )}
      </div>
      <div className="card-toggles">
        <div className="toggle-group">
          {[
            { label: "Sector", value: "sector" },
            { label: "Currency", value: "currency" },
            { label: "Country", value: "country" },
          ].map((option) => (
            <button
              key={option.value}
              className={props.allocationView === option.value ? "toggle active" : "toggle"}
              onClick={() => props.onAllocationViewChange(option.value as "sector" | "currency" | "country")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="allocation">
        {props.loading && <div className="empty">Loading allocation…</div>}
        {props.allocationBuckets.slice(0, 6).map((bucket) => (
          <div key={bucket.label} className="allocation-row">
            <div>
              <span>{bucket.label}</span>
              <span className="muted">{props.formatPercent(bucket.weight)}</span>
            </div>
            <div className="allocation-bar">
              <div className="allocation-fill" style={{ width: `${bucket.weight * 100}%` }} />
            </div>
          </div>
        ))}
        {props.allocationView === "country" && !props.allocationBuckets.length && !props.loading && (
          <div className="empty">No country data yet</div>
        )}
        {!props.allocationBuckets.length && props.allocationView !== "country" && !props.loading && (
          <div className="empty">No allocation data</div>
        )}
      </div>
    </div>
  );
}
