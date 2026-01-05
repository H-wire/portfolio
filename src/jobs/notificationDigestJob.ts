import { query } from "../db";
import { sendEmail } from "../utils/email";
import { failJobRun, logEvent, recordFailedJob, startJobRun, completeJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1004;

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function runNotificationDigestJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("notification_digest");
    const since = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let sent = 0;
    const errors: Array<{ org_id: number; user_id: number; error: string }> = [];

    try {
      const orgs = await query<{ id: number }>("select id from orgs");

      for (const org of orgs.rows) {
        const users = await query<{ user_id: number; email: string | null }>(
          "select users.id as user_id, users.email from org_members join users on users.id = org_members.user_id where org_members.org_id = $1",
          [org.id]
        );

        const signals = await query<{ id: number; signal_type: string; date: string; listing_id: number }>(
          "select id, signal_type, date, listing_id from signals where org_id = $1 and date >= $2",
          [org.id, since]
        );

        const news = await query<{ id: number; title: string; published_at: string }>(
          "select id, title, published_at from news_items where published_at >= $1 order by published_at desc",
          [since]
        );

        for (const user of users.rows) {
          if (!user.email) {
            continue;
          }
          try {
            const payload = {
              type: "DAILY_DIGEST",
              since,
              signals: signals.rows,
              news: news.rows,
            };

            const notificationResult = await query<{ id: number }>(
              "insert into notifications (org_id, user_id, status, channel, sent_at, payload) values ($1, $2, $3, $4, now(), $5) returning id",
              [org.id, user.user_id, "sent", "email", payload]
            );

            const subject = `Daily digest (${since})`;
            const text = `Signals: ${signals.rows.length}\nNews: ${news.rows.length}`;
            await sendEmail({
              to: user.email,
              subject,
              text,
            });

            sent += 1;
            await logEvent(org.id, "NOTIFICATION_DIGEST", "notification", notificationResult.rows[0].id, {
              source: "job",
              status: "ok",
              user_id: user.user_id,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            errors.push({ org_id: org.id, user_id: user.user_id, error: message });
            await recordFailedJob("notification_digest", message, { org_id: org.id, user_id: user.user_id }, "notification", undefined);
          }
        }
      }

      await completeJobRun(jobRunId);
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "NOTIFICATION_DIGEST", "job", null, {
            source: "job",
            status: "ok",
            counts: { sent, errors: errors.length },
            errors,
          })
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await failJobRun(jobRunId, message);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "NOTIFICATION_DIGEST", "job", null, {
            source: "job",
            status: "error",
            errors: [{ error: message }],
          })
        )
      );
      throw err;
    }
  });
}
