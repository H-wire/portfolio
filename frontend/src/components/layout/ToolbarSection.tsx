import type { Org, Portfolio } from "../../types";

export type ToolbarSectionProps = {
  isAuthed: boolean;
  orgId: number | null;
  orgs: Org[];
  onOrgChange: (value: number) => void;
  portfolioId: number | null;
  portfolios: Portfolio[];
  onPortfolioChange: (value: number) => void;
  marketDataStatus: string | null | undefined;
  marketDataLoading: boolean;
  portfolioName: string;
  onPortfolioNameChange: (value: string) => void;
  onCreatePortfolio: () => void;
};

export function ToolbarSection(props: ToolbarSectionProps) {
  return (
    <section className="toolbar">
      <div>
        <span className="label">Organization</span>
        <select
          value={props.orgId ?? ""}
          onChange={(e) => props.onOrgChange(Number(e.target.value))}
          disabled={!props.isAuthed}
        >
          {props.orgs.map((org) => (
            <option key={org.org_id} value={org.org_id}>
              {org.name} ({org.role})
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="label">Portfolio</span>
        <select
          value={props.portfolioId ?? ""}
          onChange={(e) => props.onPortfolioChange(Number(e.target.value))}
          disabled={!props.isAuthed}
        >
          {props.portfolios.map((portfolio) => (
            <option key={portfolio.id} value={portfolio.id}>
              {portfolio.name}
            </option>
          ))}
        </select>
      </div>
      <div className="status-pill">
        <span className="label">Market data</span>
        <span className={props.marketDataStatus === "ok" ? "pos" : "neg"}>
          {props.marketDataLoading
            ? "Checking…"
            : props.marketDataStatus === "ok"
              ? "Connected"
              : "Unavailable"}
        </span>
      </div>
      <div className="create-portfolio">
        <input
          placeholder="New portfolio name"
          value={props.portfolioName}
          onChange={(e) => props.onPortfolioNameChange(e.target.value)}
          disabled={!props.isAuthed}
        />
        <button onClick={props.onCreatePortfolio} disabled={!props.isAuthed}>
          Create
        </button>
      </div>
    </section>
  );
}
