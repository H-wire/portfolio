import type { ListingSearch } from "../../types";

export type AddHoldingCardProps = {
  isAuthed: boolean;
  marketSearchTerm: string;
  onMarketSearchTermChange: (value: string) => void;
  marketSearchLoading: boolean;
  marketSearchFetched: boolean;
  marketSearchError: string | null;
  marketSearchResults: Array<{ ticker: string; name?: string | null; exchange?: string | null }>;
  onSelectYahooResult: (result: { ticker: string; name?: string | null; exchange?: string | null }) => void;
  marketSearchResult: string | null;
  marketCreateStatus: string | null;
  marketCreateSubmitting: boolean;
  selectedListing: ListingSearch | null;
  transactionDate: string;
  onTransactionDateChange: (value: string) => void;
  transactionType: string;
  onTransactionTypeChange: (value: string) => void;
  transactionQty: string;
  onTransactionQtyChange: (value: string) => void;
  transactionPrice: string;
  onTransactionPriceChange: (value: string) => void;
  transactionFees: string;
  onTransactionFeesChange: (value: string) => void;
  holdingError: string | null;
  transactionSuccess: string | null;
  transactionSubmitting: boolean;
  onCreateTransaction: () => void;
};

export function AddHoldingCard(props: AddHoldingCardProps) {
  return (
    <div className="card span-2">
      <div className="card-header">
        <h3>Add Holding</h3>
        <span className="muted">Search Yahoo and add transactions</span>
      </div>
      <div className="strategy-grid">
        <div className="strategy-form">
          <div className="strategy-card">
            <strong>Yahoo Search</strong>
            <label>
              Query
              <input
                value={props.marketSearchTerm}
                onChange={(e) => props.onMarketSearchTermChange(e.target.value)}
              />
            </label>
            <div className="muted">
              {props.marketSearchTerm.length < 2 && "Type at least 2 characters to search."}
              {props.marketSearchTerm.length >= 2 && props.marketSearchLoading && "Searching Yahoo…"}
              {props.marketSearchTerm.length >= 2 &&
                props.marketSearchFetched &&
                !props.marketSearchLoading &&
                props.marketSearchResults.length === 0 &&
                "No Yahoo matches found."}
            </div>
            {props.marketSearchLoading && <p className="muted">Searching Yahoo…</p>}
            {props.marketSearchError && <p className="error">{props.marketSearchError}</p>}
            {props.marketSearchResults.map((result) => (
              <button
                key={`${result.ticker}-${result.exchange ?? ""}`}
                className="ghost"
                onClick={() => props.onSelectYahooResult(result)}
                disabled={!props.isAuthed || props.marketCreateSubmitting}
              >
                {result.ticker} {result.exchange ? `· ${result.exchange}` : ""}
              </button>
            ))}
            {props.marketSearchResult && <p className="muted">Selected: {props.marketSearchResult}</p>}
            {props.marketCreateStatus && <p className="muted">{props.marketCreateStatus}</p>}
            {!props.isAuthed && (props.marketSearchResult || props.marketCreateStatus) && (
              <p className="muted">Sign in to create a listing from Yahoo.</p>
            )}
          </div>
          <label>
            Selected listing
            <input value={props.selectedListing?.ticker ?? ""} readOnly />
          </label>
          <label>
            Trade date
            <input value={props.transactionDate} onChange={(e) => props.onTransactionDateChange(e.target.value)} />
          </label>
          <label>
            Type
            <select value={props.transactionType} onChange={(e) => props.onTransactionTypeChange(e.target.value)}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="DIVIDEND">DIVIDEND</option>
              <option value="FEE">FEE</option>
            </select>
          </label>
          <label>
            Quantity
            <input value={props.transactionQty} onChange={(e) => props.onTransactionQtyChange(e.target.value)} />
          </label>
          <label>
            Price
            <input
              value={props.transactionPrice}
              onChange={(e) => props.onTransactionPriceChange(e.target.value)}
              placeholder={props.transactionType === "DIVIDEND" || props.transactionType === "FEE" ? "Amount" : "Price"}
            />
          </label>
          <label>
            Fees
            <input value={props.transactionFees} onChange={(e) => props.onTransactionFeesChange(e.target.value)} />
          </label>
          {props.holdingError && <p className="error">{props.holdingError}</p>}
          {props.transactionSuccess && <p className="muted">{props.transactionSuccess}</p>}
          <button onClick={props.onCreateTransaction} disabled={!props.isAuthed || props.transactionSubmitting}>
            Add Transaction
          </button>
        </div>
      </div>
    </div>
  );
}
