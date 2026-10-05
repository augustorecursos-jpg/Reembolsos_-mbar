// Área do RH: painel, análise das solicitações, relatório da folha, base de elegibilidade e configurações.
const adm = { usuario: null, filtros: null, solicitacoes: [], colaboradores: [], folha: null, linhas: { colab: [], dep: [] } };
const ICONES = { medicamento: '💊', educacional: '🎒', creche: '🧸', oculos: '👓' };
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

// ---------- Sessão ----------
async function iniciar() {
  try {
    adm.usuario = await api('/api/admin/sessao');
    mostrarPainel();
  } catch { document.getElementById('login').focus(); }
}

async function mostrarPainel() {
  document.getElementById('tela-login').hidden = true;
  document.getElementById('lateral').hidden = false;
  document.getElementById('principal').hidden = false;
  document.getElementById('nome-rh').textContent = adm.usuario.nome;
  await carregarFiltros();
  trocarAba(location.hash.slice(1) || 'painel');
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/entrar', { method: 'POST', body: { login: document.getElementById('login').value, senha: document.getElementById('senha').value } });
    adm.usuario = await api('/api/admin/sessao');
    mostrarPainel();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('sair').addEventListener('click', async () => {
  await api('/api/admin/sair', { method: 'POST' });
  location.reload();
});

const ABAS = { painel: carregarPainel, solicitacoes: carregarSolicitacoes, folha: carregarFolha, base: carregarBase, config: carregarConfig };
function trocarAba(aba) {
  if (!ABAS[aba]) aba = 'painel';
  history.replaceState(null, '', `#${aba}`);
  document.querySelectorAll('[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  document.querySelectorAll('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
  document.getElementById('lateral').classList.remove('aberta');
  ABAS[aba]().catch(err => toast(err.message, 'erro'));
}
document.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('lateral').classList.toggle('aberta'));
document.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close(); });

async function carregarFiltros() {
  adm.filtros = await api('/api/admin/filtros');
  const f = adm.filtros;
  const opcoesComp = f.competencias.map(c => `<option value="${c}">${competenciaBR(c)}</option>`).join('');
  document.getElementById('painel-comp').innerHTML = opcoesComp;
  document.getElementById('folha-comp').innerHTML = opcoesComp;
  document.getElementById('f-comp').innerHTML = `<option value="">Todas as competências</option>${opcoesComp}`;
  document.getElementById('f-beneficio').innerHTML = `<option value="">Todos os benefícios</option>${f.beneficios.map(b => `<option value="${b.codigo}">${esc(b.nome)}</option>`).join('')}`;
  document.getElementById('f-empresa').innerHTML = `<option value="">Todas as empresas</option>${f.empresas.map(x => `<option>${esc(x)}</option>`).join('')}`;
  document.getElementById('f-unidade').innerHTML = `<option value="">Todas as unidades</option>${f.unidades.map(x => `<option>${esc(x)}</option>`).join('')}`;
}

function faixaPeriodo(p) {
  const dois = (n) => String(n).padStart(2, '0');
  const texto = p.aberto
    ? `Recebendo solicitações até ${dataBR(p.encerra_em)}${p.por_excecao ? ' (abertura excepcional)' : ''}.`
    : `Fechado para novas solicitações (janela: dia ${dois(p.dia_inicio)} ao dia ${dois(p.dia_fim)}). Próxima abertura: ${dataBR(p.proxima_abertura)}.`;
  return `<div class="faixa-periodo ${p.aberto ? '' : 'fechado'}"><span class="ponto"></span><span><strong>Portal ${p.aberto ? 'aberto' : 'fechado'}.</strong> ${esc(texto)}</span></div>`;
}

// ---------- Painel ----------
async function carregarPainel() {
  const comp = document.getElementById('painel-comp').value;
  const d = await api(`/api/admin/painel${comp ? `?competencia=${comp}` : ''}`);
  document.getElementById('painel-comp').value = d.competencia;
  const t = d.totais;
  const qtd = document.getElementById('qtd-pendentes');
  document.getElementById('painel-periodo').innerHTML = faixaPeriodo(d.periodo)
    + (d.pendentes_anteriores ? `<div class="alerta aviso" style="margin:-.4rem 0 1.2rem">⚠️ <span>${fmt(d.pendentes_anteriores)} solicitação(ões) de competências anteriores ainda em análise.</span></div>` : '');
  qtd.hidden = !t.analise;
  qtd.textContent = t.analise || '';
  const kpi = (ic, valor, rotulo, sub = '') => `<div class="kpi${String(valor).startsWith('R$') ? ' kpi-valor' : ''}"><span class="ic">${ic}</span><div><strong>${valor}</strong><span>${rotulo}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  document.getElementById('painel-kpis').innerHTML = [
    kpi('🧾', fmt(t.total), 'solicitações', `${fmt(t.colaboradores)} colaborador(es)`),
    kpi('⏳', fmt(t.analise), 'em análise', t.analise ? '<a href="#solicitacoes" data-ir-analise>Analisar agora →</a>' : 'nada pendente'),
    kpi('✅', fmt(t.aprovadas), 'aprovadas', `${reais(t.valor_aprovado)} aprovados`),
    kpi('↩️', fmt(t.reprovadas), 'reprovadas'),
    kpi('💰', reais(t.valor_solicitado), 'valor solicitado'),
    kpi('⏱️', t.dias_analise == null ? '–' : `${fmt(Math.round(t.dias_analise * 10) / 10)} d`, 'tempo médio de análise'),
    kpi('👥', fmt(d.base.ativos), 'colaboradores na base', `${fmt(d.base.dependentes)} dependentes${d.ultima_carga ? ` · carga em ${dataHoraBR(d.ultima_carga.em)}` : ''}`),
  ].join('');
  const max = Math.max(1, ...d.por_beneficio.map(b => b.valor_aprovado));
  document.getElementById('painel-beneficios').innerHTML = `
    <div class="barras-eixo"><span>R$ 0</span><span>${reais(max / 2)}</span><span>${reais(max)}</span></div>
    ${d.por_beneficio.map(b => `
      <div class="barra-linha" tabindex="0" data-dica="<strong>${esc(b.nome)}</strong><br>${reais(b.valor_aprovado)} aprovados em ${fmt(b.aprovadas)} solicitação(ões)">
        <span class="barra-rotulo">${b.icone} ${esc(b.nome.replace('Reembolso ', ''))}</span>
        <span class="barra-trilho"><i style="width:${(b.valor_aprovado / max) * 100}%"></i><b>${reais(b.valor_aprovado)}</b></span>
      </div>`).join('')}`;
  document.getElementById('painel-tab-beneficios').innerHTML = `
    <tr><th>Benefício</th><th>Total</th><th>Em análise</th><th>Aprovadas</th><th>Reprovadas</th></tr>
    ${d.por_beneficio.map(b => `<tr><td style="white-space:nowrap">${b.icone} ${esc(b.nome.replace('Reembolso ', ''))}</td><td>${fmt(b.total)}</td><td>${fmt(b.analise)}</td><td>${fmt(b.aprovadas)}</td><td>${fmt(b.reprovadas)}</td></tr>`).join('')}`;
  document.getElementById('painel-empresas').innerHTML = `
    <tr><th>Empresa</th><th>Solicitações</th><th>Valor aprovado</th></tr>
    ${d.por_empresa.map(e => `<tr><td>${esc(e.empresa)}</td><td>${fmt(e.total)}</td><td>${reais(e.valor_aprovado)}</td></tr>`).join('') || '<tr><td colspan="3">Nenhuma solicitação nesta competência.</td></tr>'}`;
}
document.getElementById('painel-comp').addEventListener('change', () => carregarPainel().catch(err => toast(err.message, 'erro')));
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-ir-analise]')) return;
  e.preventDefault();
  document.getElementById('f-comp').value = document.getElementById('painel-comp').value;
  document.getElementById('f-status').value = 'analise';
  trocarAba('solicitacoes');
});

// ---------- Solicitações ----------
const IDS_FILTRO = { competencia: 'f-comp', status: 'f-status', beneficio: 'f-beneficio', empresa: 'f-empresa', unidade: 'f-unidade', de: 'f-de', ate: 'f-ate', busca: 'f-busca' };

async function carregarSolicitacoes() {
  const q = new URLSearchParams();
  for (const [k, id] of Object.entries(IDS_FILTRO)) { const v = document.getElementById(id).value.trim(); if (v) q.set(k, v); }
  adm.solicitacoes = await api(`/api/admin/solicitacoes?${q}`);
  const lista = adm.solicitacoes;
  const total = lista.reduce((s, x) => s + x.valor_solicitado, 0);
  document.getElementById('resumo-sol').textContent = `· ${fmt(lista.length)} encontrada(s) · ${reais(total)} solicitados`;
  document.getElementById('tabela-sol').innerHTML = `
    <tr><th>Protocolo</th><th>Enviada em</th><th>Colaborador</th><th>Empresa / unidade</th><th>Benefício</th><th>Beneficiário</th><th>Documento</th><th>Solicitado</th><th>Aprovado</th><th>Status</th><th></th></tr>
    ${lista.map(s => `
      <tr>
        <td><strong>${esc(s.protocolo)}</strong></td>
        <td>${dataHoraBR(s.criado_em)}</td>
        <td>${esc(s.nome)}<br><small class="q-dica">Mat. ${esc(s.matricula)} · ${formatarCpf(s.cpf)}</small></td>
        <td>${esc(s.empresa || '–')}<br><small class="q-dica">${esc(s.unidade || '')}</small></td>
        <td>${ICONES[s.beneficio] || ''} ${esc(s.beneficio_nome.replace('Reembolso ', ''))}</td>
        <td>${esc(s.beneficiario_nome)}<br><small class="q-dica">${esc(s.beneficiario_rotulo)}</small></td>
        <td>${dataBR(s.data_documento)}<br><small class="q-dica">${fmt(s.qtd_anexos)} anexo(s)</small></td>
        <td>${reais(s.valor_solicitado)}</td>
        <td>${s.valor_aprovado != null ? reais(s.valor_aprovado) : '–'}</td>
        <td>${etiquetaStatus(s.status)}</td>
        <td><button class="btn btn-sm ${s.status === 'analise' ? 'btn-laranja' : 'btn-claro'}" data-analisar="${s.id}">${s.status === 'analise' ? 'Analisar' : 'Ver'}</button></td>
      </tr>`).join('') || '<tr><td colspan="11">Nenhuma solicitação com estes filtros.</td></tr>'}`;
}
let _buscaTimer;
for (const id of Object.values(IDS_FILTRO)) {
  const el = document.getElementById(id);
  el.addEventListener(id === 'f-busca' ? 'input' : 'change', () => {
    clearTimeout(_buscaTimer);
    _buscaTimer = setTimeout(() => carregarSolicitacoes().catch(err => toast(err.message, 'erro')), id === 'f-busca' ? 300 : 0);
  });
}
document.getElementById('tabela-sol').addEventListener('click', (e) => {
  const b = e.target.closest('[data-analisar]');
  if (b) abrirAnalise(Number(b.dataset.analisar));
});

document.getElementById('exportar-sol').addEventListener('click', () => {
  const linhas = adm.solicitacoes.map(s => ({
    Protocolo: s.protocolo, 'Enviada em': dataHoraBR(s.criado_em), Matrícula: s.matricula, Colaborador: s.nome, CPF: formatarCpf(s.cpf),
    Empresa: s.empresa, CNPJ: s.cnpj, Unidade: s.unidade, Benefício: s.beneficio_nome, Beneficiário: s.beneficiario_nome, Vínculo: s.beneficiario_rotulo,
    Competência: competenciaBR(s.competencia), 'Data do documento': dataBR(s.data_documento),
    'Valor solicitado': s.valor_solicitado / 100, 'Valor aprovado': s.valor_aprovado == null ? '' : s.valor_aprovado / 100,
    Status: STATUS[s.status]?.nome || s.status, 'Observação do RH': s.observacao_rh || '', 'Analisado por': s.analisado_por || '', 'Analisado em': dataHoraBR(s.analisado_em),
  }));
  baixarExcel(linhas, 'Solicitações', `reembolsos-solicitacoes-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

function baixarExcel(linhas, aba, arquivo) {
  if (!linhas.length) return toast('Nada para exportar.', 'erro');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba);
  XLSX.writeFile(wb, arquivo);
}

const TEXTO_ESCOPO = {
  familia_mes: 'grupo familiar na competência',
  dependente_mes: 'beneficiário na competência',
  beneficiario_periodo: 'beneficiário no período',
};

async function abrirAnalise(id) {
  const s = await api(`/api/admin/solicitacoes/${id}`);
  document.getElementById('an-protocolo').textContent = `PROTOCOLO ${s.protocolo} · ${competenciaBR(s.competencia)}`;
  document.getElementById('an-titulo').innerHTML = `${ICONES[s.beneficio] || ''} ${esc(s.beneficio_nome)} ${etiquetaStatus(s.status)}`;
  const sal = s.saldo;
  const janela = sal.janela.tipo === 'periodo' ? `documentos desde ${dataBR(sal.janela.desde)} (${sal.janela.meses} meses)` : competenciaBR(s.competencia);
  const excede = s.valor_solicitado > sal.disponivel;
  const enviados = new Set(s.anexos.map(a => a.tipo_nome));
  const faltando = s.documentos_exigidos.filter(d => !enviados.has(d));
  document.getElementById('an-corpo').innerHTML = `
    <div class="det-grade">
      <div class="det-bloco">
        <h4>Colaborador</h4>
        <dl class="dados-cad">
          <div><dt>Nome</dt><dd>${esc(s.nome)}</dd></div>
          <div><dt>Matrícula</dt><dd>${esc(s.matricula)}</dd></div>
          <div><dt>CPF</dt><dd>${formatarCpf(s.cpf)}</dd></div>
          <div><dt>Empresa</dt><dd>${esc(s.empresa || '–')}${s.cnpj ? `<br><small style="font-weight:400">${esc(s.cnpj)}</small>` : ''}</dd></div>
          <div><dt>Unidade</dt><dd>${esc(s.unidade || '–')}</dd></div>
          <div><dt>Perfil</dt><dd>${s.sucedido ? 'Sucedido' : 'Não sucedido'}</dd></div>
        </dl>
        <h4 style="margin-top:.4rem">Despesa</h4>
        <dl class="dados-cad">
          <div><dt>Beneficiário</dt><dd>${esc(s.beneficiario_nome)}<br><small style="font-weight:400">${esc(s.beneficiario_rotulo)}</small></dd></div>
          <div><dt>Data do documento</dt><dd>${dataBR(s.data_documento)}<br><small style="font-weight:400">${fmt(s.dias_documento)} dia(s) antes do envio</small></dd></div>
          <div><dt>Enviada em</dt><dd>${dataHoraBR(s.criado_em)}</dd></div>
          <div><dt>Valor solicitado</dt><dd class="valor-grande">${reais(s.valor_solicitado)}</dd></div>
          ${s.detalhes.nivel_ensino ? `<div><dt>Nível de ensino</dt><dd>${esc(s.detalhes.nivel_ensino)}</dd></div>` : ''}
          ${s.detalhes.descricao ? `<div style="grid-column:1/-1"><dt>Descrição</dt><dd>${esc(s.detalhes.descricao)}</dd></div>` : ''}
        </dl>
        <h4 style="margin-top:.4rem">Documentos <small style="text-transform:none;letter-spacing:0;color:var(--texto-suave);font-weight:400">· exigidos: ${esc(s.documentos_exigidos.join(' + '))}</small></h4>
        ${faltando.length ? `<div class="alerta erro" style="margin:0">⚠️ Faltando: ${esc(faltando.join(', '))}</div>` : ''}
        <div class="anexos-lista">${s.anexos.map(a => `<a href="/api/anexos/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.tipo_nome)} · ${esc(a.nome_original)}<small>${tamanhoArquivo(a.tamanho)}</small></a>`).join('')}</div>
        <h4 style="margin-top:.4rem">Histórico deste benefício <small style="text-transform:none;letter-spacing:0;color:var(--texto-suave);font-weight:400">· ${s.saldo.escopo === 'familia_mes' ? 'grupo familiar' : 'mesmo beneficiário'}</small></h4>
        <div class="tabela-wrap"><table class="tabela">
          <tr><th>Protocolo</th><th>Comp.</th><th>Beneficiário</th><th>Documento</th><th>Valor</th><th>Status</th></tr>
          ${s.historico.map(h => `<tr><td>${esc(h.protocolo)}</td><td>${competenciaBR(h.competencia)}</td><td>${esc(h.beneficiario_nome)}</td><td>${dataBR(h.data_documento)}</td>
            <td>${reais(h.status === 'aprovado' ? h.valor_aprovado : h.valor_solicitado)}</td><td>${etiquetaStatus(h.status)}</td></tr>`).join('') || '<tr><td colspan="6">Primeira solicitação deste benefício.</td></tr>'}
        </table></div>
      </div>
      <div class="det-bloco">
        <h4>Controle do limite</h4>
        <div class="cartao" style="padding:1rem">
          <div class="saldo">
            <span class="saldo-topo"><span>Limite (${esc(TEXTO_ESCOPO[sal.escopo])})</span><strong>${reais(sal.limite)}</strong></span>
            <span class="saldo-topo"><span>Já comprometido em outras solicitações</span><strong>${reais(sal.usado)}</strong></span>
            <span class="barra-prog ${sal.disponivel ? '' : 'saldo-zero'}"><i style="width:${Math.min(100, (sal.usado / Math.max(1, sal.limite)) * 100)}%"></i></span>
            <span class="saldo-topo"><span>Saldo para esta solicitação</span><strong>${reais(sal.disponivel)}</strong></span>
            <small>Período considerado: ${esc(janela)}. Aprovadas contam pelo valor aprovado e em análise pelo valor solicitado.</small>
          </div>
          ${s.status === 'analise' && excede ? `<div class="alerta aviso">⚠️ <span>O valor solicitado ultrapassa o saldo atual. Aprove no máximo ${reais(sal.disponivel)} ou reprove.</span></div>` : ''}
        </div>
        ${s.status === 'analise' ? `
          <form class="decisao" id="form-decisao">
            <h4>Decisão</h4>
            <label class="rotulo">Valor aprovado (R$)
              <input class="campo" name="valor_aprovado" inputmode="decimal" value="${(Math.min(s.valor_solicitado, sal.disponivel) / 100).toFixed(2).replace('.', ',')}">
              <small>Para aprovação parcial, informe um valor menor que o solicitado.</small>
            </label>
            <label class="rotulo">Observação / justificativa <small>(obrigatória para reprovar; o colaborador verá este texto)</small>
              <textarea class="campo" name="observacao" rows="3" maxlength="1000"></textarea>
            </label>
            <div class="linha-form" style="justify-content:flex-end">
              <button class="btn btn-perigo" type="button" data-decisao="reprovado">Reprovar</button>
              <button class="btn btn-laranja" type="button" data-decisao="aprovado">Aprovar</button>
            </div>
          </form>` : `
          <div class="decisao">
            <h4>Decisão</h4>
            <p style="margin:0">${etiquetaStatus(s.status)} ${s.status === 'aprovado' ? `<strong class="valor-grande" style="font-size:1.2rem">${reais(s.valor_aprovado)}</strong>` : ''}</p>
            ${s.observacao_rh ? `<p class="pre" style="margin:0">${esc(s.observacao_rh)}</p>` : ''}
            <small class="q-dica">Por ${esc(s.analisado_por || '–')} em ${dataHoraBR(s.analisado_em)}</small>
            <div class="linha-form" style="margin-top:0"><button class="btn btn-claro btn-sm" type="button" id="btn-reabrir">↺ Reabrir para nova análise</button></div>
          </div>`}
        <h4>Rastreabilidade</h4>
        <ol class="linha-tempo">${s.eventos.map(ev => `<li><strong>${esc(ev.evento)}</strong><small>${dataHoraBR(ev.em)}${ev.por ? ` · ${esc(ev.por)}` : ''}</small>${ev.detalhe ? `<p>${esc(ev.detalhe)}</p>` : ''}</li>`).join('')}</ol>
        ${s.email ? `<p class="q-dica">E-mail do colaborador: ${esc(s.email)}${adm.usuario.email_ativo ? ' (recebe os avisos de decisão)' : ''}</p>` : ''}
      </div>
    </div>`;

  const form = document.getElementById('form-decisao');
  if (form) {
    form.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-decisao]');
      if (!b) return;
      const decisao = b.dataset.decisao;
      const observacao = form.observacao.value.trim();
      if (decisao === 'reprovado' && observacao.length < 5) { form.observacao.focus(); return toast('Informe a justificativa da reprovação.', 'erro'); }
      if (decisao === 'reprovado' && !confirm('Reprovar esta solicitação? A justificativa será exibida ao colaborador.')) return;
      b.disabled = true;
      try {
        await api(`/api/admin/solicitacoes/${s.id}/decidir`, { method: 'POST', body: { decisao, observacao, valor_aprovado: form.valor_aprovado.value } });
        toast(decisao === 'aprovado' ? 'Solicitação aprovada.' : 'Solicitação reprovada.');
        document.getElementById('modal-analise').close();
        carregarSolicitacoes();
      } catch (err) {
        toast(err.message, 'erro');
        b.disabled = false;
      }
    });
  }
  const reabrir = document.getElementById('btn-reabrir');
  if (reabrir) {
    reabrir.addEventListener('click', async () => {
      const motivo = prompt('Motivo da reabertura (fica registrado no histórico):');
      if (!motivo) return;
      try {
        await api(`/api/admin/solicitacoes/${s.id}/reabrir`, { method: 'POST', body: { motivo } });
        toast('Solicitação reaberta.');
        abrirAnalise(s.id);
        carregarSolicitacoes();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }
  const modal = document.getElementById('modal-analise');
  if (!modal.open) modal.showModal();
}

// ---------- Folha ----------
async function carregarFolha() {
  const comp = document.getElementById('folha-comp').value;
  const d = await api(`/api/admin/folha${comp ? `?competencia=${comp}` : ''}`);
  adm.folha = d;
  document.getElementById('folha-comp').value = d.competencia;
  document.getElementById('folha-csv').href = `/api/admin/folha.csv?competencia=${d.competencia}`;
  document.getElementById('folha-resumo').textContent = `· ${fmt(d.linhas.length)} lançamento(s) · total ${reais(d.total)}`;
  document.getElementById('folha-aviso').innerHTML = d.pendentes
    ? `<div class="alerta aviso" style="margin:0 0 1.2rem">⚠️ <span>Ainda há <strong>${fmt(d.pendentes)}</strong> solicitação(ões) em análise em ${competenciaBR(d.competencia)}. Conclua a análise antes de extrair a base para a folha.</span></div>`
    : `<div class="alerta ok" style="margin:0 0 1.2rem">✅ <span>Todas as solicitações de ${competenciaBR(d.competencia)} foram analisadas.</span></div>`;
  document.getElementById('tabela-folha').innerHTML = `
    <tr><th>Matrícula</th><th>Colaborador</th><th>CPF</th><th>Empresa</th><th>Unidade</th><th>Benefício</th><th>Beneficiário</th><th>Valor aprovado</th><th>Verba</th><th>Aprovação</th></tr>
    ${d.linhas.map(l => `<tr><td>${esc(l.matricula)}</td><td>${esc(l.nome)}</td><td>${formatarCpf(l.cpf)}</td><td>${esc(l.empresa)}</td><td>${esc(l.unidade)}</td>
      <td>${esc(l.beneficio)}</td><td>${esc(l.beneficiario)}<br><small class="q-dica">${esc(l.parentesco)}</small></td><td><strong>${reais(l.valor_aprovado)}</strong></td>
      <td>${esc(l.verba) || '<span class="q-dica">definir</span>'}</td><td>${dataBR(l.data_aprovacao)}</td></tr>`).join('') || '<tr><td colspan="10">Nenhuma solicitação aprovada nesta competência.</td></tr>'}`;
}
document.getElementById('folha-comp').addEventListener('change', () => carregarFolha().catch(err => toast(err.message, 'erro')));
document.getElementById('folha-xlsx').addEventListener('click', () => {
  const d = adm.folha;
  if (!d) return;
  baixarExcel(d.linhas.map(l => ({
    'Matrícula': l.matricula, 'Nome do colaborador': l.nome, CPF: l.cpf, Empresa: l.empresa, CNPJ: l.cnpj, 'Unidade/lotação': l.unidade,
    Benefício: l.beneficio, Beneficiário: l.beneficiario, Parentesco: l.parentesco, Competência: competenciaBR(l.competencia),
    'Valor aprovado': l.valor_aprovado / 100, 'Verba de folha': l.verba, 'Data da aprovação': dataBR(l.data_aprovacao),
    'Aprovado por': l.aprovado_por, Protocolo: l.protocolo, Status: l.status,
  })), 'Folha', `reembolsos-folha-${d.competencia}.xlsx`);
});

// ---------- Base de elegibilidade ----------
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const CAMPOS = {
  colab: ['cpf', 'matricula', 'nome', 'email', 'empresa', 'cnpj', 'unidade', 'data_admissao', 'sucedido', 'data_desligamento', 'medicamento', 'educacional', 'creche', 'oculos'],
  dep: ['cpf_titular', 'nome', 'cpf', 'parentesco', 'data_nascimento', 'medicamento', 'educacional', 'creche', 'oculos'],
};
// Nomes alternativos aceitos no cabeçalho da planilha.
const SINONIMOS = {
  chapa: 'matricula', 'matricula/chapa': 'matricula', e_mail: 'email', lotacao: 'unidade', unidade_lotacao: 'unidade', filial: 'unidade',
  admissao: 'data_admissao', desligamento: 'data_desligamento', nascimento: 'data_nascimento', titular: 'cpf_titular', cpf_do_titular: 'cpf_titular',
  creche_baba: 'creche', baba: 'creche', educacao: 'educacional', medicamentos: 'medicamento', nome_do_dependente: 'nome', dependente: 'nome',
};
const chaveCabecalho = (c) => { const k = semAcento(c).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); return SINONIMOS[k] || k; };

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
      carregarFiltros();
    } catch (err) {
      toast(err.message, 'erro');
      btn.disabled = false;
    }
  });
}
ligarImportacao('colab', 'arq-colab', 'imp-colab', 'previa-colab', 'modo-colab', '/api/admin/base/colaboradores');
ligarImportacao('dep', 'arq-dep', 'imp-dep', 'previa-dep', 'modo-dep', '/api/admin/base/dependentes');

async function carregarBase() {
  const [colabs, cargas] = await Promise.all([api('/api/admin/colaboradores'), api('/api/admin/importacoes')]);
  adm.colaboradores = colabs;
  renderColaboradores();
  document.getElementById('tabela-cargas').innerHTML = `
    <tr><th>Data</th><th>Base</th><th>Modo</th><th>Linhas importadas</th><th>Ignoradas</th><th>Por</th></tr>
    ${cargas.map(c => `<tr><td>${dataHoraBR(c.em)}</td><td>${c.tipo === 'colaboradores' ? 'Colaboradores' : 'Dependentes'}</td><td>${c.modo === 'substituir' ? 'Substituição' : 'Atualização'}</td>
      <td>${fmt(c.linhas)}</td><td>${fmt(c.invalidas)}</td><td>${esc(c.por || '')}</td></tr>`).join('') || '<tr><td colspan="6">Nenhuma carga realizada.</td></tr>'}`;
}

function renderColaboradores() {
  const termo = semAcento(document.getElementById('busca-colab').value);
  const digitos = termo.replace(/[.\-/\s]/g, '');
  const lista = adm.colaboradores.filter(c => !termo
    || semAcento([c.nome, c.matricula, c.empresa, c.unidade, c.email].join(' ')).includes(termo)
    || (digitos && /^\d+$/.test(digitos) && c.cpf.includes(digitos)));
  const ativos = adm.colaboradores.filter(c => c.ativo).length;
  document.getElementById('qtd-colab').textContent = `· ${fmt(ativos)} ativos de ${fmt(adm.colaboradores.length)}`;
  document.getElementById('tabela-colab').innerHTML = `
    <tr><th>CPF</th><th>Matrícula</th><th>Nome</th><th>Empresa / unidade</th><th>Perfil</th><th>Dependentes</th><th>Elegibilidade</th><th>Acesso</th></tr>
    ${lista.slice(0, 500).map(c => `
      <tr class="${c.ativo ? '' : 'inativo'}">
        <td>${formatarCpf(c.cpf)}</td><td>${esc(c.matricula)}</td>
        <td>${esc(c.nome)}${c.data_desligamento ? `<br><small class="q-dica">Desligamento: ${dataBR(c.data_desligamento)}</small>` : ''}</td>
        <td>${esc(c.empresa || '–')}<br><small class="q-dica">${esc(c.unidade || '')}</small></td>
        <td>${c.sucedido ? 'Sucedido' : 'Não sucedido'}<br><small class="q-dica">Admissão ${dataBR(c.data_admissao)}</small></td>
        <td title="${esc(c.dependentes.map(d => `${d.nome} (${d.parentesco})`).join('\n'))}">${fmt(c.dependentes.length)}</td>
        <td>${Object.entries(c.beneficios).filter(([, n]) => n.length).map(([k, n]) => `<span class="etiqueta neutra" title="${esc(n.join('\n'))}">${ICONES[k]} ${n.length}</span>`).join(' ') || '<span class="q-dica">nenhum</span>'}</td>
        <td><button class="btn btn-sm ${c.ativo ? 'btn-claro' : 'btn-laranja'}" data-acesso="${c.cpf}" data-ativo="${c.ativo ? 0 : 1}">${c.ativo ? 'Bloquear' : 'Liberar'}</button></td>
      </tr>`).join('') || '<tr><td colspan="8">Nenhum colaborador. Importe a base acima.</td></tr>'}`;
}
document.getElementById('busca-colab').addEventListener('input', renderColaboradores);
document.getElementById('tabela-colab').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acesso]');
  if (!b) return;
  await api(`/api/admin/colaboradores/${b.dataset.acesso}`, { method: 'PATCH', body: { ativo: b.dataset.ativo === '1' } });
  carregarBase();
});

// ---------- Configurações ----------
const emReais = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

async function carregarConfig() {
  const [{ config, beneficios, email_ativo }, usuarios] = await Promise.all([api('/api/admin/configuracoes'), api('/api/admin/usuarios')]);
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
  document.getElementById('status-email').innerHTML = email_ativo
    ? '✉️ Avisos por e-mail <strong>ativos</strong>: o colaborador recebe a confirmação do envio e o resultado da análise.'
    : '✉️ Avisos por e-mail <strong>desativados</strong>. Para ativar, configure as variáveis SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no servidor.';
  document.getElementById('tabela-usuarios').innerHTML = `
    <tr><th>Nome</th><th>Login</th><th>Situação</th><th></th></tr>
    ${usuarios.map(u => `<tr class="${u.ativo ? '' : 'inativo'}"><td>${esc(u.nome)}</td><td>${esc(u.login)}</td><td>${u.ativo ? 'Ativo' : 'Inativo'}</td>
      <td style="white-space:nowrap">${u.id !== adm.usuario.id ? `<button class="btn btn-claro btn-sm" data-usuario="${u.id}" data-ativo="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="btn btn-claro btn-sm" data-senha-usuario="${u.id}">Nova senha</button>` : '<span class="q-dica">você</span>'}</td></tr>`).join('')}`;
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
    carregarConfig();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/usuarios', { method: 'POST', body: { nome: f.nome.value, login: f.login.value, senha: f.senha.value } });
    f.reset();
    toast('Usuário adicionado.');
    carregarConfig();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('tabela-usuarios').addEventListener('click', async (e) => {
  const at = e.target.closest('[data-usuario]');
  const se = e.target.closest('[data-senha-usuario]');
  try {
    if (at) {
      await api(`/api/admin/usuarios/${at.dataset.usuario}`, { method: 'PATCH', body: { ativo: at.dataset.ativo === '1' } });
      carregarConfig();
    } else if (se) {
      const senha = prompt('Nova senha para este usuário (mínimo 8 caracteres):');
      if (!senha) return;
      await api(`/api/admin/usuarios/${se.dataset.senhaUsuario}`, { method: 'PATCH', body: { senha } });
      toast('Senha alterada.');
    }
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/usuarios/${adm.usuario.id}`, { method: 'PATCH', body: { senha: e.target.senha.value } });
    e.target.reset();
    toast('Sua senha foi alterada.');
  } catch (err) { toast(err.message, 'erro'); }
});

// Dica flutuante dos gráficos (mouse e teclado)
const dica = document.getElementById('dica-grafico');
function mostrarDica(alvo, x, y) {
  dica.innerHTML = alvo.dataset.dica;
  dica.hidden = false;
  const r = dica.getBoundingClientRect();
  dica.style.left = `${Math.min(x + 14, innerWidth - r.width - 8)}px`;
  dica.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
document.addEventListener('mousemove', (e) => {
  const alvo = e.target.closest('[data-dica]');
  if (alvo) mostrarDica(alvo, e.clientX, e.clientY); else dica.hidden = true;
});
document.addEventListener('focusout', () => { dica.hidden = true; });

iniciar();
