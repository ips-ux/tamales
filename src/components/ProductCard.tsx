import { Flame, Leaf } from "lucide-react";
import { formatMoney } from "../lib/money";
import type { MenuProduct } from "../lib/types";
import { QuantityStepper } from "./QuantityStepper";

interface ProductCardProps {
  product: MenuProduct;
  quantities: Record<string, number>;
  onQuantityChange: (variantId: string, quantity: number) => void;
}

export function ProductCard({ product, quantities, onQuantityChange }: ProductCardProps) {
  const isSoldOut = product.status === "sold_out";

  return (
    <article className={isSoldOut ? "product-card product-card-disabled" : "product-card"}>
      <div className="product-image-wrap">
        <img src={product.imageUrl} alt="" loading="lazy" />
        <span className="spice-chip">
          {product.spiceLevel === "mild" ? <Leaf size={15} /> : <Flame size={15} />}
          {product.spiceLevel}
        </span>
        {isSoldOut && <span className="status-badge product-status-sold_out">Sold Out</span>}
      </div>
      <div className="product-body">
        <div>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </div>
        <dl className="ingredient-list">
          <div>
            <dt>Ingredients</dt>
            <dd>{product.ingredients.join(", ")}</dd>
          </div>
          <div>
            <dt>Allergy note</dt>
            <dd>{product.allergyNotice}</dd>
          </div>
        </dl>
        <div className="variant-list">
          {product.variants.map((variant) => (
            <div className="variant-row" key={variant.id}>
              <div>
                <strong>{variant.label}</strong>
                <span>
                  {variant.unitQuantity} tamales · {formatMoney(variant.priceCents)}
                </span>
              </div>
              <QuantityStepper
                label={`${product.name} ${variant.label}`}
                value={quantities[variant.id] ?? 0}
                onChange={(value) => onQuantityChange(variant.id, value)}
                max={24}
                disabled={isSoldOut}
              />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
