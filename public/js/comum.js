// Utilitários compartilhados entre as páginas (mesmos da Trilha DHO + formatação de valores e datas).
async function api(url, opcoes = {}) {
  const init = { credentials: 'same-origin', ...opcoes };
  if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const resp = await fetch(url, init);
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : await resp.text();
  if (!resp.ok) {
    const erro = new Error((dados && dados.erro) || 'Erro inesperado');
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

function mascaraCpf(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  });
}

function formatarCpf(cpf) {
  return String(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _toastTimer;
function toast(msg, tipo = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/** Centavos → "R$ 1.234,56". */
function reais(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2026-10-05" (ou "2026-10-05 13:20:00") → "05/10/2026". */
function dataBR(iso) {
  if (!iso) return '–';
  return String(iso).slice(0, 10).split('-').reverse().join('/');
}

/** Data e hora gravadas pelo servidor (UTC) → horário de Brasília. */
function dataHoraBR(sqlUtc) {
  if (!sqlUtc) return '–';
  const d = new Date(`${String(sqlUtc).replace(' ', 'T')}Z`);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "2026-10" → "out/2026". */
function competenciaBR(comp) {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [a, m] = String(comp).split('-').map(Number);
  return `${nomes[m - 1]}/${a}`;
}

const STATUS = {
  analise: { nome: 'Em análise', classe: 'analise' },
  aprovado: { nome: 'Aprovado', classe: 'ok' },
  reprovado: { nome: 'Reprovado', classe: 'nao' },
};
function etiquetaStatus(status) {
  const s = STATUS[status] || { nome: status, classe: 'neutra' };
  return `<span class="etiqueta ${s.classe}">${s.nome}</span>`;
}

function tamanhoArquivo(bytes) {
  if (!bytes) return '';
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
