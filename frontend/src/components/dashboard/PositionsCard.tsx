import type { Position } from "../../types";

export type PositionsCardProps = {
  positions: Position[];
  loading: boolean;
  baseCurrency: string;
  formatMoney: (value: number | null, currency?: string) => string;
  onOpenSeedDrawer: () => void;
  onOpenPositionDrawer: (pos: Position) => void;
  onEditSeedDrawer: (pos: Position) => void;
};

export function PositionsCard(props: PositionsCardProps) {
  return (
    <div className="card span-2">
      <h3>Positions</h3>
      <div className="card-actions">
        <button className="ghost" onClick={props.onOpenSeedDrawer}>
          Add holding
        </button>
      </div>
      <div className="table">
        <div className="table-header">
          <span>Ticker</span>
          <span>Qty</span>
          <span>Last Close</span>
          <span>Day</span>
          <span>Total PnL</span>
          <span>Action</span>
        </div>
        {props.loading && <div className="empty">Loading positions…</div>}
        {props.positions.map((pos) => (
          <div
            key={pos.listing_id}
            className="table-row clickable"
            onMouseDown={() => props.onOpenPositionDrawer(pos)}
          >
            <span>{pos.ticker ?? "—"}</span>
            <span>{pos.quantity.toFixed(2)}</span>
            <span>{props.formatMoney(pos.price_close, pos.currency ?? props.baseCurrency)}</span>
            <span className={Number(pos.day_change_base) >= 0 ? "pos" : "neg"}>
              {props.formatMoney(pos.day_change_base, props.baseCurrency)}
            </span>
            <span className={Number(pos.total_pnl_base) >= 0 ? "pos" : "neg"}>
              {props.formatMoney(pos.total_pnl_base, "$" )}
            </span>
            <button
              className="ghost"
              onClick={(event) => {
                event.stopPropagation();
                props.onEditSeedDrawer(pos);
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
