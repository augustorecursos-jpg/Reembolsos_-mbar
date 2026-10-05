// Administração do portal (somente perfil administrador): base de elegibilidade, colaboradores e bloqueio de acesso,
// usuários e perfis, período e benefícios, acesso ao portal (suspensão), auditoria e backup.
const adm = { usuario: null, colaboradores: [], auditoria: [], linhas: { colab: [], dep: [] } };

const area = iniciarArea({
  exigeAdmin: true,
  abaPadrao: 'visao',
  abas: { visao: carregarVisao, base: carregarBase, colaboradores: carregarColaboradores, usuarios: carregarUsuarios, regras: carregarRegras, portal: carregarPortal, auditoria: carregarAuditoria },
  aoEntrar: async (usuario) => { adm.usuario = usuario; },
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]');
  if (b) area.trocarAba(b.dataset.ir);
});

// ---------- Visão geral ----------
async function carregarVisao() {
  const d = await api('/api/admin/visao-geral');
  const p = d.periodo;
  document.getElementById('visao-alertas').innerHTML = (d.suspenso
    ? `<div class="alerta erro" style="margin:0 0 1.2rem">🚦 <span><strong>Portal suspenso para os colaboradores.</strong> ${esc(d.mensagem_suspensao || '')} <a href="#portal" data-ir="portal">Reativar →</a></span></div>`
    : faixaPeriodo(p))
    + (d.falhas_login_24h >= 5 ? `<div class="alerta aviso" style="margin:-.4rem 0 1.2rem">⚠️ <span>${fmt(d.falhas_login_24h)} tentativas de login com senha errada nas últimas 24 h. <a href="#auditoria" data-ir="auditoria">Ver auditoria →</a></span></div>` : '');
  const c = d.colaboradores;
  const u = d.usuarios;
  const sol = d.solicitacoes;
  document.getElementById('visao-kpis').innerHTML = [
    kpi('👥', fmt(c.ativos), 'colaboradores com acesso', `${fmt(c.bloqueados)} bloqueado(s) · ${fmt(d.dependentes)} dependentes`),
    kpi('🔓', fmt(c.acessaram), 'já acessaram o portal', c.total ? `${Math.round((c.acessaram / c.total) * 100)}% da base` : ''),
    kpi('🔐', fmt((u.rh || 0) + (u.admin || 0)), 'usuários internos ativos', `${fmt(u.rh)} RH · ${fmt(u.admin)} admin${u.bloqueados ? ` · ${fmt(u.bloqueados)} bloqueado(s)` : ''}`),
    kpi('🧾', fmt(sol.total), 'solicitações no total', `${fmt(sol.analise)} em análise · ${fmt(sol.aprovadas)} aprovadas · ${fmt(sol.reprovadas)} reprovadas`),
    kpi('📥', d.ultima_carga ? dataBR(d.ultima_carga.em) : '–', 'última carga da base', d.ultima_carga ? `${d.ultima_carga.tipo} · ${fmt(d.ultima_carga.linhas)} linhas · ${esc(d.ultima_carga.por || '')}` : 'nenhuma carga ainda'),
  ].join('');
  document.getElementById('visao-acoes').innerHTML = d.ultimas_acoes.map(a => `<li><strong>${esc(a.acao)}</strong><small>${dataHoraBR(a.em)}${a.usuario ? ` · ${esc(a.usuario)}` : ''}</small>${a.detalhe ? `<p>${esc(a.detalhe)}</p>` : ''}</li>`).join('') || '<li>Nenhuma ação registrada ainda.</li>';
}

// ---------- Base de elegibilidade ----------
const CAMPOS = {
  colab: ['cpf', 'matricula', 'nome', 'email', 'unidade', 'data_admissao', 'sucedido', 'data_desligamento', 'medicamento', 'educacional', 'creche', 'oculos'],
  dep: ['cpf_titular', 'nome', 'cpf', 'parentesco', 'data_nascimento', 'medicamento', 'educacional', 'creche', 'oculos'],
};
// Nomes alternativos aceitos no cabeçalho da planilha.
// Ex.: "Filial", "Lotação", "Data de Admissão", "CPF do Titular" e "Matrícula/Chapa" são reconhecidos.
const SINONIMOS = {
  chapa: 'matricula', matricula_chapa: 'matricula', e_mail: 'email', lotacao: 'unidade', unidade_lotacao: 'unidade',
  filial: 'unidade', filiall: 'unidade', local: 'unidade', local_trabalho: 'unidade',
  admissao: 'data_admissao', desligamento: 'data_desligamento', nascimento: 'data_nascimento', titular: 'cpf_titular',
  creche_baba: 'creche', baba: 'creche', educacao: 'educacional', medicamentos: 'medicamento', nome_dependente: 'nome', dependente: 'nome',
  nome_completo: 'nome', nome_colaborador: 'nome', grau_parentesco: 'parentesco',
};
/** Normaliza o cabeçalho: sem acentos, maiúsculas ou espaços, e sem “de/do/da” (“Data de Admissão” → data_admissao). */
const chaveCabecalho = (c) => {
  const k = semAcento(c).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').split('_').filter(p => !['de', 'do', 'da', 'dos', 'das'].includes(p)).join('_');
  return SINONIMOS[k] || k;
};

/** Lê .xlsx/.csv no navegador. Em planilhas com várias abas, usa a aba “Colaboradores” ou “Dependentes”. */
async function lerPlanilha(arquivo, tipo) {
  // CSV é lido como texto puro: sem isso o leitor interpreta 10/07/1980 no formato americano (mês/dia).
  // As datas em DD/MM/AAAA são convertidas no servidor; no Excel, células de data chegam como Date.
  const csv = /\.csv$/i.test(arquivo.name);
  const wb = XLSX.read(await arquivo.arrayBuffer(), csv ? { type: 'array', raw: true, codepage: 65001 } : { type: 'array', cellDates: true });
  const nomeAba = wb.SheetNames.find(n => semAcento(n).startsWith(tipo === 'colab' ? 'colab' : 'depend')) || wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: '', raw: true });
  if (!matriz.length) return [];
  const campos = CAMPOS[tipo];
  const cab = matriz[0].map(chaveCabecalho);
  const temCabecalho = cab.some(c => campos.includes(c));
  const indice = Object.fromEntries(campos.map((c, i) => [c, temCabecalho ? cab.indexOf(c) : i]));
  const texto = (v) => {
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    return String(v ?? '').trim();
  };
  return matriz.slice(temCabecalho ? 1 : 0)
    .filter(l => l.some(v => String(v).trim()))
    .map(l => Object.fromEntries(campos.map(c => [c, indice[c] >= 0 ? texto(l[indice[c]]) : ''])));
}

function ligarImportacao(tipo, idArquivo, idBotao, idPrevia, nomeModo, rota) {
  const previa = document.getElementById(idPrevia);
  const btn = document.getElementById(idBotao);
  document.getElementById(idArquivo).addEventListener('change', async (e) => {
    const arq = e.target.files[0];
    adm.linhas[tipo] = [];
    btn.disabled = true;
    previa.innerHTML = '';
    if (!arq) return;
    try { adm.linhas[tipo] = await lerPlanilha(arq, tipo); } catch (err) {
      previa.innerHTML = `<p class="aviso">Não foi possível ler o arquivo: ${esc(err.message)}</p>`;
      return;
    }
    const cols = CAMPOS[tipo].slice(0, 6);
    previa.innerHTML = `
      <p><strong>${fmt(adm.linhas[tipo].length)}</strong> linhas encontradas. Prévia:</p>
      <div class="tabela-wrap"><table class="tabela">
        <tr>${cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('')}</tr>
        ${adm.linhas[tipo].slice(0, 5).map(l => `<tr>${cols.map(c => `<td>${esc(l[c])}</td>`).join('')}</tr>`).join('')}
      </table></div>`;
    btn.disabled = !adm.linhas[tipo].length;
  });
  btn.addEventListener('click', async () => {
    const modo = document.querySelector(`input[name="${nomeModo}"]:checked`).value;
    if (modo === 'substituir' && !confirm(tipo === 'colab'
      ? 'Substituir a base? Colaboradores que não estiverem na planilha perderão o acesso (o histórico é mantido).'
      : 'Substituir a base de dependentes? Dependentes que não estiverem na planilha deixarão de aparecer (o histórico é mantido).')) return;
    btn.disabled = true;
    try {
      const r = await api(rota, { method: 'POST', body: { linhas: adm.linhas[tipo], modo } });
      previa.innerHTML = `
        <p>✅ <strong>${fmt(r.importados)}</strong> ${tipo === 'colab' ? 'colaboradores' : 'dependentes'} importados · ${fmt(r.ativos)} ativos na base.</p>
        ${r.invalidas.length ? `<p class="aviso">${r.invalidas.length} linha(s) ignorada(s): ${r.invalidas.slice(0, 10).map(i => `linha ${i.linha} (${esc(i.motivo)})`).join(', ')}${r.invalidas.length > 10 ? '…' : ''}</p>` : ''}`;
      document.getElementById(idArquivo).value = '';
      adm.linhas[tipo] = [];
      carregarBase();
    } catch (err) {
      toast(err.message, 'erro');
      btn.disabled = false;
    }
  });
}
ligarImportacao('colab', 'arq-colab', 'imp-colab', 'previa-colab', 'modo-colab', '/api/admin/base/colaboradores');
ligarImportacao('dep', 'arq-dep', 'imp-dep', 'previa-dep', 'modo-dep', '/api/admin/base/dependentes');

async function carregarBase() {
  const cargas = await api('/api/admin/importacoes');
  document.getElementById('tabela-cargas').innerHTML = `
    <tr><th>Data</th><th>Base</th><th>Modo</th><th>Linhas importadas</th><th>Ignoradas</th><th>Por</th></tr>
    ${cargas.map(c => `<tr><td>${dataHoraBR(c.em)}</td><td>${c.tipo === 'colaboradores' ? 'Colaboradores' : 'Dependentes'}</td><td>${c.modo === 'substituir' ? 'Substituição' : 'Atualização'}</td>
      <td>${fmt(c.linhas)}</td><td>${fmt(c.invalidas)}</td><td>${esc(c.por || '')}</td></tr>`).join('') || '<tr><td colspan="6">Nenhuma carga realizada.</td></tr>'}`;
}

// ---------- Colaboradores e bloqueio de acesso ----------
async function carregarColaboradores() {
  adm.colaboradores = await api('/api/admin/colaboradores');
  renderColaboradores();
}

function renderColaboradores() {
  const termo = semAcento(document.getElementById('busca-colab').value);
  const situacao = document.getElementById('filtro-acesso').value;
  const digitos = termo.replace(/[.\-/\s]/g, '');
  const lista = adm.colaboradores.filter(c => (situacao === '' || String(c.ativo) === situacao) && (!termo
    || semAcento([c.nome, c.matricula, c.unidade, c.email].join(' ')).includes(termo)
    || (digitos && /^\d+$/.test(digitos) && c.cpf.includes(digitos))));
  const ativos = adm.colaboradores.filter(c => c.ativo).length;
  document.getElementById('qtd-colab').textContent = `· ${fmt(ativos)} com acesso · ${fmt(adm.colaboradores.length - ativos)} bloqueado(s)`;
  document.getElementById('tabela-colab').innerHTML = `
    <tr><th>CPF</th><th>Matrícula</th><th>Nome</th><th>Unidade</th><th>Perfil</th><th>Dependentes</th><th>Elegibilidade</th><th>Último acesso</th><th>Acesso</th></tr>
    ${lista.slice(0, 500).map(c => `
      <tr class="${c.ativo ? '' : 'inativo'}">
        <td>${formatarCpf(c.cpf)}</td><td>${esc(c.matricula)}</td>
        <td>${esc(c.nome)}${c.data_desligamento ? `<br><small class="q-dica">Desligamento: ${dataBR(c.data_desligamento)}</small>` : ''}</td>
        <td>${esc(c.unidade || '–')}</td>
        <td>${c.sucedido ? 'Sucedido' : 'Não sucedido'}<br><small class="q-dica">Admissão ${dataBR(c.data_admissao)}</small></td>
        <td title="${esc(c.dependentes.map(d => `${d.nome} (${d.parentesco})`).join('\n'))}">${fmt(c.dependentes.length)}</td>
        <td>${Object.entries(c.beneficios).filter(([, n]) => n.length).map(([k, n]) => `<span class="etiqueta neutra" title="${esc(n.join('\n'))}">${ICONES[k]} ${n.length}</span>`).join(' ') || '<span class="q-dica">nenhum</span>'}</td>
        <td>${c.ultimo_acesso ? dataHoraBR(c.ultimo_acesso) : '<span class="q-dica">nunca</span>'}</td>
        <td>${c.ativo ? '<span class="etiqueta ok">Liberado</span>' : '<span class="etiqueta nao">Bloqueado</span>'}<br>
          <button class="btn btn-sm ${c.ativo ? 'btn-perigo' : 'btn-laranja'}" style="margin-top:.3rem" data-acesso="${c.cpf}" data-nome="${esc(c.nome)}" data-ativo="${c.ativo ? 0 : 1}">${c.ativo ? 'Bloquear' : 'Liberar'}</button></td>
      </tr>`).join('') || '<tr><td colspan="9">Nenhum colaborador encontrado.</td></tr>'}
    ${lista.length > 500 ? '<tr><td colspan="9" class="q-dica">Mostrando os 500 primeiros. Use a busca para encontrar outros.</td></tr>' : ''}`;
}
document.getElementById('busca-colab').addEventListener('input', renderColaboradores);
document.getElementById('filtro-acesso').addEventListener('change', renderColaboradores);
document.getElementById('tabela-colab').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acesso]');
  if (!b) return;
  const liberar = b.dataset.ativo === '1';
  if (!liberar && !confirm(`Bloquear o acesso de ${b.dataset.nome}? A pessoa é desconectada na hora e não consegue entrar até ser liberada.`)) return;
  try {
    await api(`/api/admin/colaboradores/${b.dataset.acesso}`, { method: 'PATCH', body: { ativo: liberar } });
    toast(liberar ? 'Acesso liberado.' : 'Acesso bloqueado.');
    carregarColaboradores();
  } catch (err) { toast(err.message, 'erro'); }
});

// ---------- Usuários e perfis ----------
async function carregarUsuarios() {
  const usuarios = await api('/api/admin/usuarios');
  document.getElementById('tabela-usuarios').innerHTML = `
    <tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr>
    ${usuarios.map(u => {
      const eu = u.id === adm.usuario.id;
      return `<tr class="${u.ativo ? '' : 'inativo'}">
        <td>${esc(u.nome)}${eu ? ' <span class="etiqueta neutra">você</span>' : ''}</td><td>${esc(u.login)}</td>
        <td><select class="campo" style="padding:.35rem .5rem;width:auto" data-perfil="${u.id}" ${eu ? 'disabled title="Você não pode alterar o próprio perfil"' : ''}>
          ${Object.entries(PERFIS).map(([k, v]) => `<option value="${k}" ${u.perfil === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${u.ativo ? '<span class="etiqueta ok">Ativo</span>' : '<span class="etiqueta nao">Bloqueado</span>'}</td>
        <td>${u.ultimo_acesso ? dataHoraBR(u.ultimo_acesso) : '<span class="q-dica">nunca</span>'}</td>
        <td style="white-space:nowrap">${eu ? '<button class="btn btn-claro btn-sm" data-minha-senha-tabela>Trocar minha senha</button>' : `
          <button class="btn btn-sm ${u.ativo ? 'btn-perigo' : 'btn-laranja'}" data-usuario="${u.id}" data-nome="${esc(u.nome)}" data-ativo="${u.ativo ? 0 : 1}">${u.ativo ? 'Bloquear' : 'Desbloquear'}</button>
          <button class="btn btn-claro btn-sm" data-senha-usuario="${u.id}" data-nome="${esc(u.nome)}">Nova senha</button>`}</td></tr>`;
    }).join('')}`;
}

document.getElementById('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/usuarios', { method: 'POST', body: { nome: f.nome.value, login: f.login.value, senha: f.senha.value, perfil: f.perfil.value } });
    f.reset();
    toast('Usuário adicionado.');
    carregarUsuarios();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('tabela-usuarios').addEventListener('click', async (e) => {
  const at = e.target.closest('[data-usuario]');
  const se = e.target.closest('[data-senha-usuario]');
  if (e.target.closest('[data-minha-senha-tabela]')) { document.querySelector('[data-minha-senha]').click(); return; }
  try {
    if (at) {
      const desbloquear = at.dataset.ativo === '1';
      if (!desbloquear && !confirm(`Bloquear ${at.dataset.nome}? O acesso é cortado na hora.`)) return;
      await api(`/api/admin/usuarios/${at.dataset.usuario}`, { method: 'PATCH', body: { ativo: desbloquear } });
      toast(desbloquear ? 'Usuário desbloqueado.' : 'Usuário bloqueado.');
      carregarUsuarios();
    } else if (se) {
      const senha = prompt(`Nova senha para ${se.dataset.nome} (mínimo 8 caracteres):`);
      if (!senha) return;
      await api(`/api/admin/usuarios/${se.dataset.senhaUsuario}`, { method: 'PATCH', body: { senha } });
      toast('Senha redefinida. Informe a nova senha ao usuário.');
    }
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('tabela-usuarios').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-perfil]');
  if (!sel) return;
  if (!confirm(`Alterar o perfil para “${PERFIS[sel.value]}”?`)) { carregarUsuarios(); return; }
  try {
    await api(`/api/admin/usuarios/${sel.dataset.perfil}`, { method: 'PATCH', body: { perfil: sel.value } });
    toast('Perfil alterado.');
  } catch (err) { toast(err.message, 'erro'); }
  carregarUsuarios();
});

// ---------- Período, limites e verbas ----------
const emReais = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

async function carregarRegras() {
  const { config, beneficios } = await api('/api/admin/configuracoes');
  const f = document.getElementById('form-config');
  f.dia_inicio.value = config.dia_inicio;
  f.dia_fim.value = config.dia_fim;
  f.prazo_documento_dias.value = config.prazo_documento_dias;
  f.excecao_ate.value = config.excecao_ate || '';
  const campo = (cod, nome, valor, extra = '') => `<input class="campo" style="padding:.45rem .6rem;min-width:110px" data-b="${cod}" data-campo="${nome}" value="${esc(valor)}" ${extra}>`;
  document.getElementById('tabela-config-beneficios').innerHTML = `
    <tr><th>Ativo</th><th>Benefício</th><th>Limite</th><th>Verba de folha</th></tr>
    ${Object.entries(beneficios).map(([cod, b]) => {
      const c = config.beneficios[cod];
      let limites;
      if (b.escopo === 'dependente_mes') {
        limites = `<div class="linha-form" style="margin:0"><label class="rotulo">Sucedido (R$)${campo(cod, 'limiteSucedido', emReais(c.limiteSucedido))}</label>
          <label class="rotulo">Não sucedido (R$)${campo(cod, 'limiteNaoSucedido', emReais(c.limiteNaoSucedido))}</label></div><small class="q-dica">por dependente, por mês</small>`;
      } else if (b.escopo === 'familia_mes') {
        limites = `<label class="rotulo">Grupo familiar / mês (R$)${campo(cod, 'limite', emReais(c.limite))}</label>`;
      } else {
        limites = `<div class="linha-form" style="margin:0"><label class="rotulo">Por beneficiário (R$)${campo(cod, 'limite', emReais(c.limite))}</label>
          <label class="rotulo">Período (meses)${campo(cod, 'periodoMeses', c.periodoMeses, 'type="number" min="1" max="60"')}</label></div>`;
      }
      return `<tr><td><input type="checkbox" data-b="${cod}" data-campo="ativo" ${c.ativo ? 'checked' : ''} aria-label="Ativo"></td>
        <td>${b.icone} <strong>${esc(b.nome)}</strong></td><td>${limites}</td><td>${campo(cod, 'verba', c.verba, 'placeholder="Código da verba"')}</td></tr>`;
    }).join('')}`;
}

document.getElementById('form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const corpo = {
    dia_inicio: Number(f.dia_inicio.value), dia_fim: Number(f.dia_fim.value), prazo_documento_dias: Number(f.prazo_documento_dias.value),
    excecao_ate: f.excecao_ate.value, beneficios: {},
  };
  f.querySelectorAll('[data-b]').forEach(el => {
    corpo.beneficios[el.dataset.b] = corpo.beneficios[el.dataset.b] || {};
    corpo.beneficios[el.dataset.b][el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try {
    await api('/api/admin/configuracoes', { method: 'PUT', body: corpo });
    toast('Configurações salvas.');
    carregarRegras();
  } catch (err) { toast(err.message, 'erro'); }
});


// ---------- Acesso ao portal (suspensão), e-mail ----------
async function carregarPortal() {
  const { config, email_ativo } = await api('/api/admin/configuracoes');
  const f = document.getElementById('form-suspensao');
  f.portal_suspenso.checked = config.portal_suspenso;
  f.mensagem_suspensao.value = config.mensagem_suspensao || '';
  document.getElementById('situacao-portal').innerHTML = config.portal_suspenso
    ? '<div class="alerta erro" style="margin:.2rem 0 1rem">🚦 <span><strong>Suspenso:</strong> nenhum colaborador consegue entrar no portal agora.</span></div>'
    : '<div class="alerta ok" style="margin:.2rem 0 1rem">✅ <span><strong>Liberado:</strong> os colaboradores da base conseguem entrar normalmente.</span></div>';
  document.getElementById('status-email').innerHTML = email_ativo
    ? 'Avisos por e-mail <strong>ativos</strong>: o colaborador recebe a confirmação do envio e o resultado da análise.'
    : 'Avisos por e-mail <strong>desativados</strong>. Para ativar, configure as variáveis SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no servidor (Render → Environment).';
}

document.getElementById('form-suspensao').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.portal_suspenso.checked && !confirm('Suspender o portal? Todos os colaboradores perdem o acesso até a reativação.')) return;
  try {
    await api('/api/admin/configuracoes', { method: 'PUT', body: { portal_suspenso: f.portal_suspenso.checked, mensagem_suspensao: f.mensagem_suspensao.value } });
    toast(f.portal_suspenso.checked ? 'Portal suspenso para os colaboradores.' : 'Portal liberado para os colaboradores.');
    carregarPortal();
  } catch (err) { toast(err.message, 'erro'); }
});

// ---------- Auditoria ----------
async function carregarAuditoria() {
  const q = new URLSearchParams();
  for (const [k, id] of [['de', 'aud-de'], ['ate', 'aud-ate'], ['busca', 'aud-busca']]) { const v = document.getElementById(id).value.trim(); if (v) q.set(k, v); }
  adm.auditoria = await api(`/api/admin/auditoria?${q}`);
  document.getElementById('qtd-auditoria').textContent = `· ${fmt(adm.auditoria.length)} registro(s)${adm.auditoria.length === 1000 ? ' (mais recentes)' : ''}`;
  document.getElementById('tabela-auditoria').innerHTML = `
    <tr><th>Data e hora</th><th>Usuário</th><th>Perfil</th><th>Ação</th><th>Detalhe</th><th>IP</th></tr>
    ${adm.auditoria.map(a => `<tr class="${/Falha|recusado/.test(a.acao) ? 'alerta-linha' : ''}"><td style="white-space:nowrap">${dataHoraBR(a.em)}</td><td>${esc(a.usuario || '–')}</td>
      <td>${esc(PERFIS[a.perfil] || '–')}</td><td><strong>${esc(a.acao)}</strong></td><td>${esc(a.detalhe || '')}</td><td class="q-dica">${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum registro.</td></tr>'}`;
}
let _audTimer;
for (const id of ['aud-de', 'aud-ate', 'aud-busca']) {
  document.getElementById(id).addEventListener(id === 'aud-busca' ? 'input' : 'change', () => {
    clearTimeout(_audTimer);
    _audTimer = setTimeout(() => carregarAuditoria().catch(err => toast(err.message, 'erro')), 300);
  });
}
document.getElementById('aud-exportar').addEventListener('click', () => {
  baixarExcel(adm.auditoria.map(a => ({ 'Data e hora': dataHoraBR(a.em), Usuário: a.usuario || '', Perfil: PERFIS[a.perfil] || '', Ação: a.acao, Detalhe: a.detalhe || '', IP: a.ip || '' })),
    'Auditoria', `reembolsos-auditoria-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
