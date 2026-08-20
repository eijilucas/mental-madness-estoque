async function fetchProduction() {
  const res = await fetch("/api/production");
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Não autenticado");
  }
  if (!res.ok) throw new Error("Falha ao carregar /api/production");
  return res.json();
}

async function adjustStock(productId, size, color, { delta, value } = {}) {
  const res = await fetch("/api/stock/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, size, color: color || null, delta, value }),
  });
  if (!res.ok) throw new Error("Falha ao ajustar estoque");
  return res.json();
}

function stockCell(productId, size, color, value) {
  return `
    <span class="stockcell" data-product="${productId}" data-size="${size}" data-color="${color || ""}">
      <span class="stockval" tabindex="0" title="Clique pra digitar uma quantidade">${value}</span>
      <span class="stockadj">
        <button data-delta="-1" aria-label="Remover 1">−</button>
        <button data-delta="1" aria-label="Adicionar 1">+</button>
      </span>
    </span>`;
}

function statusPills(row) {
  const pills = [];
  if (row.produzir > 0) {
    pills.push(`<span class="pill warn">produzir</span>`);
  } else {
    pills.push(`<span class="pill ok">ok</span>`);
  }
  if (row.critico) {
    pills.push(`<span class="pill crit">crítico</span>`);
  }
  return `<span class="statuscell">${pills.join("")}</span>`;
}

// Uma tabela por produto — tamanho e cor como colunas separadas (a coluna de
// cor só aparece se o produto tiver variação de cor), pra não repetir o nome
// do produto em toda linha nem misturar as duas dimensões numa coisa só.
function renderProductPanel(product, kind) {
  const hasColor = product.sizes.some((r) => r.color);

  const middleColumns =
    kind === "exclusivo"
      ? [
          { key: "restantes", label: "Estoque", title: "Peças prontas que ainda não foram enviadas" },
          { key: "naoProcessados", label: "Não process.", title: "Pedidos esperando estoque pra serem enviados" },
        ]
      : [
          { key: "estoqueReal", label: "Estoque", title: "Peças prontas que ainda não foram enviadas" },
          { key: "minimo", label: "Mínimo", title: "Estoque de segurança que esse produto nunca deve furar" },
        ];

  const stockKey = kind === "exclusivo" ? "restantes" : "estoqueReal";

  const rows = product.sizes
    .map((r) => {
      const cols = middleColumns
        .map(({ key }) =>
          key === stockKey
            ? `<td class="mono">${stockCell(product.id, r.size, r.color, r[key])}</td>`
            : `<td class="mono">${r[key]}</td>`
        )
        .join("");

      const rowKey = `${product.id}::${r.size}::${r.color || ""}`;
      return `
        <tr data-row-key="${rowKey}">
          <td class="size">${r.size}</td>
          ${hasColor ? `<td>${r.color || "—"}</td>` : ""}
          ${cols}
          <td class="produce ${r.produzir > 0 ? "pos" : "zero"}">${r.produzir}</td>
          <td>${statusPills(r)}</td>
        </tr>`;
    })
    .join("");

  const closedPill =
    kind === "exclusivo" && product.drop && product.drop.status === "encerrado"
      ? `<span class="pill closed">encerrado</span>`
      : "";

  return `
    <div class="panel">
      <div class="panel-head">
        <h2><span class="swatch ${kind === "exclusivo" ? "excl" : "basico"}"></span>${product.name}</h2>
        ${closedPill}
      </div>
      <div class="tablescroll">
      <table class="prod">
        <thead>
          <tr>
            <th class="mono">Tam.</th>
            ${hasColor ? "<th>Cor</th>" : ""}
            ${middleColumns.map((c) => `<th class="mono" title="${c.title}">${c.label}</th>`).join("")}
            <th class="mono" title="Quanto mandar pra fábrica agora">Produzir</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    </div>`;
}

function renderSectionLabel(text) {
  return `<div class="sectionlabel">${text}</div>`;
}

function renderAlertbar(products) {
  const critical = [];
  for (const product of products) {
    for (const row of product.sizes) {
      if (row.critico) {
        critical.push({
          rowKey: `${product.id}::${row.size}::${row.color || ""}`,
          name: product.name,
          size: row.size,
          color: row.color || null,
          estoque: row.restantes ?? row.estoqueReal,
        });
      }
    }
  }

  document.getElementById("bell-count").textContent = critical.length;
  document.getElementById("bell-count").classList.toggle("zero", critical.length === 0);

  const list = document.getElementById("bell-list");
  if (critical.length === 0) {
    list.innerHTML = `<div class="bellpanel-empty">Nenhum item crítico agora.</div>`;
    return;
  }
  list.innerHTML = critical
    .map(
      (item) => `
        <button class="bellpanel-item" data-row-key="${item.rowKey}">
          <span class="name">${item.name}</span>
          <span class="meta">${item.size}${item.color ? " · " + item.color : ""} — estoque ${item.estoque}</span>
        </button>`
    )
    .join("");
}

function renderKpis(summary) {
  document.getElementById("kpi-produzir").textContent = summary.pecasAProduzir;
  document.getElementById("kpi-pedidos").textContent = summary.pedidosNaoProcessados;
  document.getElementById("kpi-skus").textContent = summary.skusAfetados;
}

async function render() {
  const groups = document.getElementById("groups");
  try {
    const { products, summary } = await fetchProduction();

    const exclusivos = products.filter((p) => p.type === "exclusivo");
    const basicos = products.filter((p) => p.type === "basico");

    if (products.length === 0) {
      groups.innerHTML = `
        <div class="panel">
          <div class="panel-body loading">Nenhum produto cadastrado ainda. Assim que o Shopify sincronizar (ou um produto for cadastrado à mão), a lista de produção aparece aqui.</div>
        </div>`;
    } else {
      const basicoCol = basicos.length
        ? renderSectionLabel("Básico") + basicos.map((p) => renderProductPanel(p, "basico")).join("")
        : "";
      const exclusivoCol = exclusivos.length
        ? renderSectionLabel("Exclusivo") + exclusivos.map((p) => renderProductPanel(p, "exclusivo")).join("")
        : "";

      groups.innerHTML = `
        <div class="columns">
          <div class="col">${basicoCol}</div>
          <div class="col">${exclusivoCol}</div>
        </div>`;
    }

    renderKpis(summary);
    renderAlertbar(products);

    groups.querySelectorAll(".stockadj button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cell = btn.closest(".stockcell");
        const { product, size, color } = cell.dataset;
        const delta = Number(btn.dataset.delta);
        btn.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
          await adjustStock(product, size, color, { delta });
          await render();
        } catch (err) {
          alert(err.message);
          btn.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
      });
    });

    // Clicar no número abre um campo pra digitar a quantidade certa de uma vez
    // — evita ter que clicar em +1 dezenas de vezes.
    groups.querySelectorAll(".stockval").forEach((el) => {
      const openEditor = () => {
        const cell = el.closest(".stockcell");
        const { product, size, color } = cell.dataset;
        const current = el.textContent.trim();

        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.value = current;
        input.className = "stockedit";
        cell.replaceChild(input, el);
        input.focus();
        input.select();

        let settled = false;
        const commit = async () => {
          if (settled) return;
          settled = true;
          const newValue = Number(input.value);
          if (!Number.isFinite(newValue) || newValue < 0 || String(newValue) === current) {
            await render();
            return;
          }
          try {
            await adjustStock(product, size, color, { value: newValue });
          } catch (err) {
            alert(err.message);
          }
          await render();
        };

        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") input.blur();
          if (ev.key === "Escape") {
            settled = true;
            render();
          }
        });
      };
      el.addEventListener("click", openEditor);
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openEditor();
        }
      });
    });
  } catch (err) {
    groups.innerHTML = `<div class="panel"><div class="error">Erro ao carregar: ${err.message}</div></div>`;
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

const bellBtn = document.getElementById("bell-btn");
const bellPanel = document.getElementById("bell-panel");

bellBtn.addEventListener("click", (ev) => {
  ev.stopPropagation();
  bellPanel.hidden = !bellPanel.hidden;
});

document.addEventListener("click", (ev) => {
  if (!bellPanel.hidden && !bellPanel.contains(ev.target) && ev.target !== bellBtn) {
    bellPanel.hidden = true;
  }
});

document.getElementById("bell-list").addEventListener("click", (ev) => {
  const item = ev.target.closest(".bellpanel-item");
  if (!item) return;
  bellPanel.hidden = true;
  const row = document.querySelector(`tr[data-row-key="${item.dataset.rowKey}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("flash-highlight");
  void row.offsetWidth; // reinicia a animação se clicar de novo no mesmo item
  row.classList.add("flash-highlight");
});

render();

// Recarrega os dados sozinho, sem precisar apertar F5 — o servidor já
// sincroniza com o Shopify por conta própria em segundo plano. Pula a
// atualização se tiver alguém no meio de uma edição de estoque, pra não
// apagar o que a pessoa tava digitando.
setInterval(() => {
  if (document.querySelector(".stockedit")) return;
  render();
}, 60_000);
