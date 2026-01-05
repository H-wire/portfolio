import ReactMarkdown from "react-markdown";
import type { AnalysisResult } from "../../types";

export type PortfolioAnalysisModalProps = {
  open: boolean;
  analysis: AnalysisResult | null;
  onClose: () => void;
};

export function PortfolioAnalysisModal(props: PortfolioAnalysisModalProps) {
  if (!props.open || !props.analysis) {
    return null;
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>AI Portfolio Review</h3>
          <button className="ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <ReactMarkdown>{props.analysis.response_text}</ReactMarkdown>
      </div>
    </div>
  );
}
