import type { Deal } from "../lib/types";
import { calcInstalment } from "../lib/compute";

const currency = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0
});

const plainAmount = (value: number) => Math.round(value).toLocaleString("en-PK");

type DealCardProps = {
  deal: Deal;
  onSelect: (id: string) => void;
  onReceive: (id: string) => void;
};


export default function DealCard({ deal, onSelect, onReceive }: DealCardProps) {
  const remaining = Math.max(0, deal.remainingAmount);
  const isClosed = remaining <= 0;
  const receivedThisMonth = deal.received > 0 || deal.receipts.length > 0;
  const expectedInstalment = deal.instalment > 0 ? deal.instalment : calcInstalment(deal.invested, deal.months);
  
  const receivedAmount = deal.receipts.length > 0
    ? deal.receipts.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0)
    : (Number.isFinite(deal.received) ? deal.received : 0);

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
          <div className="deal-row__title">
            <span className="deal-row__deal-no">{deal.dealNo}</span>
            <span className="deal-row__name">{deal.customer || "Untitled"}</span>
          </div>
        </div>
      </div>
      <div className="deal-row__right">
        <span className="deal-row__recoverable">{currency.format(deal.total)}</span>
        <span
          className={`deal-row__badge ${receivedThisMonth ? "deal-row__badge--yes" : "deal-row__badge--no"}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isClosed && !receivedThisMonth) onReceive(deal.id);
          }}
          title={receivedThisMonth ? "Received this month" : "Not received — tap to add"}
        >
          <span className="deal-row__badge-text">
            {receivedThisMonth ? plainAmount(receivedAmount) : plainAmount(expectedInstalment)}
          </span>
          <span className="deal-row__badge-icon" aria-hidden>
            {receivedThisMonth ? "✓" : "×"}
          </span>
        </span>
      </div>
    </article>
  );
}
