// Chave única de uma variante (tamanho + cor, quando existe cor).
// Usado em todo lugar que precisa achar/gravar o estoque de um tamanho
// específico — mapeamento do Shopify, cálculo e API — pra não ter três
// jeitos diferentes de montar a mesma chave.

function variantKey(size, color) {
  return color ? `${size}::${color}` : size;
}

module.exports = { variantKey };
