// As duas regras de produção definidas no playbook.
// Exclusivo: certeiro, sem estoque de segurança.
// Básico: sempre disponível, com mínimo por produto.
// Cada variante é tamanho + cor (quando o produto tem cor) — duas cores do
// mesmo tamanho são peças diferentes pra produzir.

function countNaoProcessados(orders, productId, size, color) {
  return orders.filter(
    (o) =>
      o.productId === productId &&
      o.size === size &&
      (o.color || null) === (color || null) &&
      o.status === "nao_processado"
  ).length;
}

function minimoDoProduto(product, config) {
  const categoria = product.category || "default";
  return config.minimoPorCategoria[categoria] ?? config.minimoPorCategoria.default;
}

// produzir[variante] = máx(0, não processados[variante] − restantes[variante])
function calcExclusivo(product, orders) {
  return Object.values(product.sizes).map((data) => {
    const naoProcessados = countNaoProcessados(orders, product.id, data.size, data.color);
    const restantes = data.estoqueReal;
    const produzir = Math.max(0, naoProcessados - restantes);
    return { size: data.size, color: data.color || null, restantes, naoProcessados, produzir };
  });
}

// produzir[variante] = máx(0, mínimo − estoque real[variante])
function calcBasico(product, config) {
  const minimo = minimoDoProduto(product, config);
  return Object.values(product.sizes).map((data) => {
    const estoqueReal = data.estoqueReal;
    const produzir = Math.max(0, minimo - estoqueReal);
    return { size: data.size, color: data.color || null, estoqueReal, minimo, produzir };
  });
}

// crítico[variante] = estoque restante[variante] < limite
function isCritico(estoqueOuRestantes, config) {
  return estoqueOuRestantes < config.estoqueCritico;
}

module.exports = { calcExclusivo, calcBasico, isCritico, countNaoProcessados, minimoDoProduto };
