import ReactMarkdown from "react-markdown";
import type { AnalysisResult } from "../../types";

export type RecommendationExplainModalProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  result: AnalysisResult | null;
  onClose: () => void;
};

export function RecommendationExplainModal(props: RecommendationExplainModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Recommendation Explanation</h3>
          <button className="ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.loading && <div className="empty">Loading explanation…</div>}
        {props.error && <p className="error">{props.error}</p>}
        {props.result && <ReactMarkdown>{props.result.response_text}</ReactMarkdown>}
      </div>
    </div>
  );
}
