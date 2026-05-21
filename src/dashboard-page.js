'use strict';

function dashboardPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>SalvaMoney Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0a1628;color:#f0f4ff;min-height:100vh}
header{background:#0f2040;border-bottom:1px solid rgba(255,255,255,.1);padding:18px 24px;display:flex;align-items:center;gap:12px}
header h1{font-size:1.1rem;color:#00c896;font-weight:700}
header p{color:#8ba0cc;font-size:.8rem;margin-left:auto}
main{max-width:960px;margin:0 auto;padding:24px 16px}
.card{background:#1a3060;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;margin-bottom:16px}
h2{font-size:.8rem;color:#8ba0cc;text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px}
.total{font-size:2.2rem;font-weight:700;color:#00c896;margin:4px 0}
.sub{font-size:.78rem;color:#8ba0cc;margin-bottom:4px}
input{width:100%;background:#0f2040;border:1px solid rgba(255,255,255,.18);border-radius:8px;color:#f0f4ff;padding:10px 14px;font-size:.9rem;margin-bottom:10px;outline:none}
input:focus{border-color:#00c896}
button{background:#00c896;color:#03120e;border:none;border-radius:8px;padding:10px 22px;font-size:.88rem;font-weight:700;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.88}
.btn-sm{background:transparent;color:#ff6b6b;border:1px solid rgba(255,107,107,.35);padding:4px 10px;font-size:.75rem;border-radius:6px;cursor:pointer}
.btn-sm:hover{background:rgba(255,107,107,.12)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.cat-item{background:#0f2040;border-radius:10px;padding:12px}
.cat-name{font-size:.8rem;color:#8ba0cc;margin-bottom:4px}
.cat-val{font-weight:700;color:#f0f4ff;margin-bottom:6px;font-size:.95rem}
.bar{height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden}
.bar-inner{height:100%;background:#00c896;border-radius:3px;transition:width .5s}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th{color:#8ba0cc;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;padding:8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}
td{padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
.origem{display:inline-block;font-size:.65rem;background:rgba(0,200,150,.12);color:#00c896;border-radius:4px;padding:1px 5px}
.err{color:#ff6b6b;font-size:.8rem;margin-top:6px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.row input{margin-bottom:0;flex:1;min-width:200px}
.hidden{display:none}
</style>
</head>
<body>
<header><h1>💰 SalvaMoney</h1><p>Dashboard de gastos</p></header>
<main>
  <div class="card">
    <h2>Entrar</h2>
    <p class="sub" style="margin-bottom:10px">Digite o telefone com DDI+DDD. Ex: 5521999999999</p>
    <div class="row">
      <input id="phone" placeholder="Telefone WhatsApp"/>
      <button onclick="carregar()">Carregar</button>
    </div>
    <p id="erro" class="err"></p>
  </div>

  <div id="resumo-card" class="card hidden">
    <h2 id="tituloMes">Resumo</h2>
    <p class="sub" id="conta"></p>
    <div class="total" id="total">R$ 0,00</div>
  </div>

  <div id="cats-card" class="card hidden">
    <h2>Por categoria</h2>
    <div id="categorias" class="grid"></div>
  </div>

  <div id="ultimos-card" class="card hidden">
    <h2>Últimos gastos</h2>
    <div id="ultimos"></div>
  </div>
</main>

<script>
const params = new URLSearchParams(location.search);
const phoneParam = params.get('phone') || '';
const tokenParam = params.get('token') || params.get('dashboard_token') || '';
document.getElementById('phone').value = phoneParam;

function moeda(v) {
  return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}

function esc(v) {
  return String(v||'').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function apiQuery(phone) {
  const query = new URLSearchParams({ phone });

  if (tokenParam) query.set('token', tokenParam);

  return query.toString();
}

async function carregar() {
  const phone = document.getElementById('phone').value.trim();
  const erro = document.getElementById('erro');
  erro.textContent = '';

  if (!phone) {
    erro.textContent = 'Digite o telefone.';
    return;
  }

  const r = await fetch('/api/dashboard?' + apiQuery(phone));
  const dados = await r.json();

  if (!dados.ok) {
    erro.textContent = dados.error || 'Erro ao carregar.';
    return;
  }

  document.getElementById('tituloMes').textContent = 'Resumo de ' + dados.mes;
  document.getElementById('conta').textContent = dados.sessao.user + ' · Grupo ' + dados.sessao.group;
  document.getElementById('total').textContent = moeda(dados.total);

  ['resumo-card','cats-card','ultimos-card'].forEach(id => {
    document.getElementById(id).classList.remove('hidden');
  });

  const cats = Object.entries(dados.porCat||{}).sort((a,b)=>b[1]-a[1]);
  const maior = cats.length ? cats[0][1] : 1;

  document.getElementById('categorias').innerHTML = cats.map(([c,v]) =>
    '<div class="cat-item"><div class="cat-name">'+esc(c)+'</div><div class="cat-val">'+moeda(v)+'</div>' +
    '<div class="bar"><div class="bar-inner" style="width:'+Math.round(v/maior*100)+'%"></div></div></div>'
  ).join('') || '<p style="color:#8ba0cc">Nenhum gasto.</p>';

  renderTabela(dados.ultimos, phone);
}

function renderTabela(ultimos, phone) {
  if (!ultimos.length) {
    document.getElementById('ultimos').innerHTML = '<p style="color:#8ba0cc">Nenhum gasto.</p>';
    return;
  }

  document.getElementById('ultimos').innerHTML =
    '<table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Origem</th><th>Valor</th><th></th></tr></thead><tbody>' +
    ultimos.map(i =>
      '<tr><td>'+esc(i.date)+'</td><td>'+esc(i.desc)+'</td><td>'+esc(i.cat)+'</td>' +
      '<td><span class="origem">'+esc(i.origem)+'</span></td>' +
      '<td>'+moeda(i.value)+'</td>' +
      '<td><button class="btn-sm" onclick="apagar(\\''+esc(i.id)+'\\',\\''+encodeURIComponent(phone)+'\\')">Apagar</button></td></tr>'
    ).join('') + '</tbody></table>';
}

async function apagar(id, phoneEnc) {
  if (!confirm('Apagar este gasto?')) return;

  const query = apiQuery(decodeURIComponent(phoneEnc));
  const r = await fetch('/api/gasto/'+encodeURIComponent(id)+'?'+query, { method: 'DELETE' });
  const d = await r.json();

  if (d.ok) carregar();
  else alert(d.error || 'Erro ao apagar.');
}

if (phoneParam) carregar();
</script>
</body>
</html>`;
}

module.exports = {
  dashboardPage,
};
