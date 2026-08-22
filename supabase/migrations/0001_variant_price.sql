-- Preço de venda real da variante, vindo da Shopify (variant.price) no
-- sync. Usado pelo sistema de vendas externas via GET /api/catalog/variants
-- pra não precisar digitar preço na mão. NULL até o próximo sync depois
-- desta migration ser aplicada.
--
-- Nota: este repositório não tinha pasta supabase/migrations até agora
-- (schema real só existia implicitamente em src/db.js — ver
-- docs/decisions/001 no repo mental-madness-vendas-externas). Esta é a
-- primeira migration de fato; o schema anterior (drops/products/variants/
-- orders) segue só implícito por enquanto.

alter table variants add column price numeric(12, 2);
