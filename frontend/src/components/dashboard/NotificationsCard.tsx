import type { Notification } from "../../types";

export type NotificationsCardProps = {
  notifications: Notification[];
  loading: boolean;
  onMarkRead: (id: number) => void;
};

export function NotificationsCard(props: NotificationsCardProps) {
  return (
    <div className="card">
      <h3>Notifications</h3>
      <div className="signals">
        {props.loading && <div className="empty">Loading notifications…</div>}
        {props.notifications.map((note) => (
          <div key={note.id} className="signal-row">
            <div>
              <strong>{note.status}</strong>
              <span>{note.channel}</span>
            </div>
            <button className="ghost" onClick={() => props.onMarkRead(note.id)}>
              Mark read
            </button>
          </div>
        ))}
        {(!props.notifications.length && !props.loading && (
          <div className="empty">No notifications</div>
        )) || null}
      </div>
    </div>
  );
}
