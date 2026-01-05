import type { NewsItem } from "../../types";

export type NewsCardProps = {
  newsItems: NewsItem[];
  loading: boolean;
  formatNewsMatch: (bases?: string[]) => string;
};

export function NewsCard(props: NewsCardProps) {
  return (
    <div className="card span-2">
      <h3>News</h3>
      <div className="signals">
        {props.loading && <div className="empty">Loading news…</div>}
        {props.newsItems.map((news) => (
          <a key={news.id} className="news-row" href={news.url} target="_blank" rel="noreferrer">
            <div>
              <strong>{news.title}</strong>
              <span>{news.source}{props.formatNewsMatch(news.match_bases)}</span>
            </div>
            <span>{news.published_at.slice(0, 10)}</span>
          </a>
        ))}
        {(!props.newsItems.length && !props.loading && (
          <div className="empty">No news</div>
        )) || null}
      </div>
    </div>
  );
}
