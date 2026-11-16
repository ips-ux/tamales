import { Flame, Leaf } from "lucide-react";
import { quantityLabel } from "../../shared/quantity";
import { formatMoney } from "../lib/money";
import type { MenuProduct } from "../lib/types";
import { cartKey, maxQuantity, stockText, type Cart, type MenuEntry } from "./order/orderFlowLogic";
import { QuantityStepper } from "./QuantityStepper";

interface ProductCardProps {
  entry: MenuEntry<MenuProduct>;
  cart: Cart;
  /** Tamales that remain for this item, or null when the item has no limit. */
  left: number | null;
  onQuantityChange: (key: string, quantity: number) => void;
}

/** One menu item in the order flow, with a quantity row for each option. */
export function ProductCard({ entry, cart, left, onQuantityChange }: ProductCardProps) {
  const { item, options } = entry;
  const soldOut = entry.soldOut || left === 0;

  return (
    <article className={soldOut ? "product-card product-card-disabled" : "product-card"}>
      <div className="product-image-wrap">
        {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" />}
        {item.spiceLevel && (
          <span className="spice-chip">
            {item.spiceLevel === "mild" ? (
              <Leaf size={15} aria-hidden="true" />
            ) : (
              <Flame size={15} aria-hidden="true" />
            )}
            {item.spiceLevel}
          </span>
        )}
        {soldOut && <span className="status-badge product-status-sold_out">Sold out</span>}
      </div>
      <div className="product-body">
        <div>
          <h3>{item.name}</h3>
          {item.description && <p>{item.description}</p>}
          {left !== null && !soldOut && <p className="product-stock">{stockText(left)}</p>}
        </div>
        {item.ingredients.length > 0 && (
          <dl className="ingredient-list">
            <div>
              <dt>Ingredients</dt>
              <dd>{item.ingredients.join(", ")}</dd>
            </div>
          </dl>
        )}
        <div className="variant-list">
          {options.map((option) => {
            const key = cartKey(option.itemId, option.variantId);
            const quantity = cart[key] ?? 0;
            const max = soldOut ? 0 : maxQuantity(option, cart, entry, left);
            return (
              <div className="variant-row" key={key}>
                <div>
                  <strong>{option.label}</strong>
                  <span>
                    {quantityLabel(option.unitTamales)}, {formatMoney(option.priceCents)}
                  </span>
                  {option.minimum > 1 && <span>Minimum {option.minimum}</span>}
                  {quantity > 0 && (
                    <span className="variant-total">{quantityLabel(quantity * option.unitTamales)}</span>
                  )}
                </div>
                <QuantityStepper
                  label={`${item.name}, ${option.label}`}
                  value={quantity}
                  minimum={option.minimum}
                  max={max}
                  disabled={soldOut}
                  onChange={(value) => onQuantityChange(key, value)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
