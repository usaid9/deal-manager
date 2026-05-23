import type { Deal } from "../lib/types";

const currency = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0
});

type DealCardProps = {
  deal: Deal;
  onSelect: (id: string) => void;
  onReceive: (id: string) => void;
};

export default function DealCard({ deal, onSelect, onReceive }: DealCardProps) {
  const remaining = Math.max(0, deal.remainingAmount);
  const isClosed = remaining <= 0;
  const receivedThisMonth = deal.received > 0 || deal.receipts.length > 0;

  return (
    <article
      className="deal-row"
      onClick={() => onSelect(deal.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(deal.id)}
    >
      <div className="deal-row__left">
        <span className={`deal-row__dot ${isClosed ? "deal-row__dot--closed" : "deal-row__dot--active"}`} />
        <div className="deal-row__info">
          <span className="deal-row__name">{deal.customer || "Untitled"}</span>
          <span className="deal-row__sub">#{deal.dealNo}</span>
        </div>
      </div>
      <div className="deal-row__right">
        <span className="deal-row__invested">{currency.format(deal.invested)}</span>
        <span
          className={`deal-row__badge ${receivedThisMonth ? "deal-row__badge--yes" : "deal-row__badge--no"}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isClosed && !receivedThisMonth) onReceive(deal.id);
          }}
          title={receivedThisMonth ? "Received this month" : "Not received — tap to add"}
        >
          {receivedThisMonth ? "✓" : "—"}
        </span>
      </div>
    </article>
  );
}
