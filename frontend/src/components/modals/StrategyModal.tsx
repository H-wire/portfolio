import ReactMarkdown from "react-markdown";

export type StrategyModalProps = {
  open: boolean;
  overview: string;
  onClose: () => void;
};

export function StrategyModal(props: StrategyModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Strategy Overview</h3>
          <button className="ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <ReactMarkdown>{props.overview}</ReactMarkdown>
      </div>
    </div>
  );
}
