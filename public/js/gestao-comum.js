// Código comum às áreas internas: Área do RH (rh.html) e Administração (admin.html).
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const ICONES = { medicamento: '💊', educacional: '🎒', creche: '🧸', oculos: '👓' };
const PERFIS = { rh: 'RH (análise)', admin: 'Administrador' };
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Login, sessão e navegação por abas de uma área interna.
 * exigeAdmin: a Administração só abre para o perfil administrador.
 */
function iniciarArea({ exigeAdmin, abas, abaPadrao, aoEntrar }) {
  const area = { usuario: null };
  const login = document.getElementById('tela-login');
  const negado = document.getElementById('acesso-negado');

  function trocarAba(aba) {
    if (!abas[aba]) aba = abaPadrao;
    history.replaceState(null, '', `#${aba}`);
    document.querySelectorAll('[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
    document.querySelectorAll('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
    document.getElementById('lateral').classList.remove('aberta');
    abas[aba]().catch(err => toast(err.message, 'erro'));
  }
  area.trocarAba = trocarAba;

  async function mostrar() {
    login.hidden = true;
    if (exigeAdmin && area.usuario.perfil !== 'admin') { negado.hidden = false; return; }
    document.getElementById('lateral').hidden = false;
    document.getElementById('principal').hidden = false;
    document.getElementById('nome-usuario').textContent = area.usuario.nome;
    document.getElementById('perfil-usuario').textContent = PERFIS[area.usuario.perfil] || '';
    document.querySelectorAll('[data-so-admin]').forEach(el => { el.hidden = area.usuario.perfil !== 'admin'; });
    if (aoEntrar) await aoEntrar(area.usuario);
    trocarAba(location.hash.slice(1) || abaPadrao);
  }

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/entrar', { method: 'POST', body: { login: document.getElementById('login').value, senha: document.getElementById('senha').value } });
      area.usuario = await api('/api/admin/sessao');
      mostrar();
    } catch (err) { toast(err.message, 'erro'); }
  });
  document.querySelectorAll('[data-sair]').forEach(b => b.addEventListener('click', async () => {
    await api('/api/admin/sair', { method: 'POST' });
    location.reload();
  }));
  document.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('lateral').classList.toggle('aberta'));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close(); });

  // Troca da própria senha (qualquer perfil).
  const modalSenha = document.getElementById('modal-senha');
  document.querySelectorAll('[data-minha-senha]').forEach(b => b.addEventListener('click', () => { modalSenha.querySelector('form').reset(); modalSenha.showModal(); }));
  modalSenha.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.nova_senha.value !== f.confirmar.value) return toast('A confirmação não confere com a nova senha.', 'erro');
    try {
      await api('/api/admin/minha-senha', { method: 'POST', body: { senha_atual: f.senha_atual.value, nova_senha: f.nova_senha.value } });
      modalSenha.close();
      toast('Sua senha foi alterada.');
    } catch (err) { toast(err.message, 'erro'); }
  });

  (async () => {
    try {
      area.usuario = await api('/api/admin/sessao');
      mostrar();
    } catch { document.getElementById('login').focus(); }
  })();
  return area;
}

function faixaPeriodo(p) {
  const dois = (n) => String(n).padStart(2, '0');
  const texto = p.aberto
    ? `Recebendo solicitações até ${dataBR(p.encerra_em)}${p.por_excecao ? ' (abertura excepcional)' : ''}.`
    : `Fechado para novas solicitações (janela: dia ${dois(p.dia_inicio)} ao dia ${dois(p.dia_fim)}). Próxima abertura: ${dataBR(p.proxima_abertura)}.`;
  return `<div class="faixa-periodo ${p.aberto ? '' : 'fechado'}"><span class="ponto"></span><span><strong>Portal ${p.aberto ? 'aberto' : 'fechado'}.</strong> ${esc(texto)}</span></div>`;
}

function baixarExcel(linhas, aba, arquivo) {
  if (!linhas.length) return toast('Nada para exportar.', 'erro');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba);
  XLSX.writeFile(wb, arquivo);
}

const kpi = (ic, valor, rotulo, sub = '') => `<div class="kpi${String(valor).startsWith('R$') ? ' kpi-valor' : ''}"><span class="ic">${ic}</span><div><strong>${valor}</strong><span>${rotulo}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;

// Dica flutuante dos gráficos (mouse e teclado)
(() => {
  const dica = document.getElementById('dica-grafico');
  if (!dica) return;
  const mostrarDica = (alvo, x, y) => {
    dica.innerHTML = alvo.dataset.dica;
    dica.hidden = false;
    const r = dica.getBoundingClientRect();
    dica.style.left = `${Math.min(x + 14, innerWidth - r.width - 8)}px`;
    dica.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  document.addEventListener('mousemove', (e) => {
    const alvo = e.target.closest('[data-dica]');
    if (alvo) mostrarDica(alvo, e.clientX, e.clientY); else dica.hidden = true;
  });
  document.addEventListener('focusout', () => { dica.hidden = true; });
})();
