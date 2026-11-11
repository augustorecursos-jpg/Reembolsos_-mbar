// Área do RH: painel, análise das solicitações (aprovar, reprovar, reabrir e comentar) e relatório da folha.
const adm = { usuario: null, filtros: null, solicitacoes: [], folha: null };

const area = iniciarArea({
  exigeAdmin: false,
  abaPadrao: 'painel',
  abas: { painel: carregarPainel, solicitacoes: carregarSolicitacoes, recadastro: carregarRecadastro, folha: carregarFolha, colaboradores: Colaboradores.carregar },
  aoEntrar: async (usuario) => { adm.usuario = usuario; await carregarFiltros(); aplicarBuscaPendente(); atualizarRecadastro().catch(() => {}); },
});

/** Histórico completo de um colaborador: todas as solicitações dele, de qualquer status e competência. */
function verHistorico(cpf) {
  for (const id of ['f-comp', 'f-status', 'f-beneficio', 'f-unidade', 'f-de', 'f-ate']) document.getElementById(id).value = '';
  document.getElementById('f-busca').value = cpf;
  area.trocarAba('solicitacoes');
}
// Vindo da Administração (“ver” solicitações de um colaborador).
function aplicarBuscaPendente() {
  let cpf = null;
  try { cpf = sessionStorage.getItem('rh-historico-cpf'); sessionStorage.removeItem('rh-historico-cpf'); } catch { /* sem storage */ }
  if (cpf) { verHistorico(cpf); }
}
Colaboradores.montar(document.getElementById('area-colaboradores'), { aoVerHistorico: verHistorico });
const trocarAba = (aba) => area.trocarAba(aba);

async function carregarFiltros() {
  adm.filtros = await api('/api/admin/filtros');
  const f = adm.filtros;
  const opcoesComp = f.competencias.map(c => `<option value="${c}">${competenciaBR(c)}</option>`).join('');
  document.getElementById('painel-comp').innerHTML = opcoesComp;
  document.getElementById('folha-comp').innerHTML = opcoesComp;
  document.getElementById('folha-comp').value = f.competencia_folha;
  document.getElementById('painel-comp').value = f.competencia_atual;
  document.getElementById('f-comp').innerHTML = `<option value="">Todas as competências</option>${opcoesComp}`;
  document.getElementById('f-beneficio').innerHTML = `<option value="">Todos os benefícios</option>${f.beneficios.map(b => `<option value="${b.codigo}">${esc(b.nome)}</option>`).join('')}`;
  document.getElementById('f-unidade').innerHTML = `<option value="">Todas as unidades</option>${f.unidades.map(x => `<option>${esc(x)}</option>`).join('')}`;
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
  document.getElementById('painel-unidades').innerHTML = `
    <tr><th>Unidade</th><th>Solicitações</th><th>Valor aprovado</th></tr>
    ${d.por_unidade.map(e => `<tr><td>${esc(e.unidade)}</td><td>${fmt(e.total)}</td><td>${reais(e.valor_aprovado)}</td></tr>`).join('') || '<tr><td colspan="3">Nenhuma solicitação nesta competência.</td></tr>'}`;
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
const IDS_FILTRO = { competencia: 'f-comp', status: 'f-status', beneficio: 'f-beneficio', unidade: 'f-unidade', de: 'f-de', ate: 'f-ate', busca: 'f-busca' };

async function carregarSolicitacoes() {
  const q = new URLSearchParams();
  for (const [k, id] of Object.entries(IDS_FILTRO)) { const v = document.getElementById(id).value.trim(); if (v) q.set(k, v); }
  adm.solicitacoes = await api(`/api/admin/solicitacoes?${q}`);
  const lista = adm.solicitacoes;
  const total = lista.reduce((s, x) => s + x.valor_solicitado, 0);
  document.getElementById('resumo-sol').textContent = `· ${fmt(lista.length)} encontrada(s) · ${reais(total)} solicitados`;
  document.getElementById('tabela-sol').innerHTML = `
    <tr><th>Protocolo</th><th>Enviada em</th><th>Colaborador</th><th>Unidade</th><th>Benefício</th><th>Beneficiário</th><th>Documento</th><th>Solicitado</th><th>Aprovado</th><th>Status</th><th></th></tr>
    ${lista.map(s => `
      <tr>
        <td><strong>${esc(s.protocolo)}</strong></td>
        <td>${dataHoraBR(s.criado_em)}</td>
        <td>${esc(s.nome)}<br><small class="q-dica">Mat. ${esc(s.matricula)} · ${formatarCpf(s.cpf)}</small></td>
        <td>${esc(s.unidade || '–')}</td>
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
    Unidade: s.unidade, Benefício: s.beneficio_nome, Beneficiário: s.beneficiario_nome, Vínculo: s.beneficiario_rotulo,
    Competência: competenciaBR(s.competencia), 'Data do documento': dataBR(s.data_documento),
    'Valor solicitado': s.valor_solicitado / 100, 'Valor aprovado': s.valor_aprovado == null ? '' : s.valor_aprovado / 100,
    Status: STATUS[s.status]?.nome || s.status, 'Observação do RH': s.observacao_rh || '', 'Analisado por': s.analisado_por || '', 'Analisado em': dataHoraBR(s.analisado_em),
  }));
  baixarExcel(linhas, 'Solicitações', `reembolsos-solicitacoes-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

const TEXTO_ESCOPO = {
  familia_mes: 'grupo familiar na competência',
  dependente_mes: 'beneficiário na competência',
  beneficiario_periodo: 'beneficiário no período',
  dependente_janela: 'dependente no mês da janela',
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
          <div><dt>Unidade</dt><dd>${esc(s.unidade || '–')}</dd></div>
          <div><dt>Perfil</dt><dd>${s.sucedido ? 'Sucedido' : 'Não sucedido'}</dd></div>
        </dl>
        <h4 style="margin-top:.4rem">Despesa</h4>
        <dl class="dados-cad">
          <div><dt>Beneficiário</dt><dd>${esc(s.beneficiario_nome)}<br><small style="font-weight:400">${esc(s.beneficiario_rotulo)}${s.elegibilidade?.idade_envio ? ` · ${esc(s.elegibilidade.idade_envio)} no envio (nasc. ${dataBR(s.elegibilidade.nascimento)})` : ''}</small></dd></div>
          <div><dt>Data do documento</dt><dd>${dataBR(s.data_documento)}<br><small style="font-weight:400">${fmt(s.dias_documento)} dia(s) antes do envio</small></dd></div>
          <div><dt>Enviada em</dt><dd>${dataHoraBR(s.criado_em)}</dd></div>
          <div><dt>Valor solicitado</dt><dd class="valor-grande">${reais(s.valor_solicitado)}</dd></div>
          ${s.detalhes.nivel_ensino ? `<div><dt>Nível de ensino</dt><dd>${esc(s.detalhes.nivel_ensino)}</dd></div>` : ''}
          ${s.detalhes.descricao ? `<div style="grid-column:1/-1"><dt>Descrição</dt><dd>${esc(s.detalhes.descricao)}</dd></div>` : ''}
        </dl>
        ${s.elegibilidade && (!s.elegibilidade.elegivel || s.elegibilidade.origem !== 'regra') ? `<div class="alerta ${s.elegibilidade.elegivel ? 'aviso' : 'erro'}" style="margin:0">⚠️ <span>${s.elegibilidade.elegivel
          ? `<strong>Elegível ${esc(s.elegibilidade.texto)}.</strong>${s.elegibilidade.motivo_regra ? ` Pela regra: ${esc(s.elegibilidade.motivo_regra.toLowerCase())}` : ''}`
          : `<strong>Hoje não é elegível:</strong> ${esc(s.elegibilidade.texto)}`}</span></div>` : ''}
        <h4 style="margin-top:.4rem">Documentos <small style="text-transform:none;letter-spacing:0;color:var(--texto-suave);font-weight:400">· exigidos: ${esc(s.documentos_exigidos.join(' + '))}</small></h4>
        ${faltando.length ? `<div class="alerta erro" style="margin:0">⚠️ Faltando: ${esc(faltando.join(', '))}</div>` : ''}
        <div class="anexos-lista">${s.anexos.map(a => `<a href="/api/anexos/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.tipo_nome)} · ${esc(a.nome_original)}<small>${tamanhoArquivo(a.tamanho)}</small></a>`).join('')}</div>
        <h4 style="margin-top:.4rem">Histórico deste benefício <small style="text-transform:none;letter-spacing:0;color:var(--texto-suave);font-weight:400">· ${s.saldo.escopo === 'familia_mes' ? 'grupo familiar' : 'mesmo beneficiário'}</small></h4>
        <div class="tabela-wrap"><table class="tabela">
          <tr><th>Protocolo</th><th>Comp.</th><th>Beneficiário</th><th>Documento</th><th>Valor</th><th>Status</th></tr>
          ${s.historico.map(h => `<tr><td>${esc(h.protocolo)}</td><td>${competenciaBR(h.competencia)}</td><td>${esc(h.beneficiario_nome)}</td><td>${dataBR(h.data_documento)}</td>
            <td>${reais(h.status === 'aprovado' ? h.valor_aprovado : h.valor_solicitado)}</td><td>${etiquetaStatus(h.status)}</td></tr>`).join('')}
          ${(s.pagos_fora || []).map(h => `<tr><td><small class="q-dica">Pago fora do portal</small></td><td>–</td><td>${esc(h.beneficiario_nome)}</td><td>${dataBR(h.data_pagamento)}</td>
            <td>${reais(h.valor)}</td><td><span class="etiqueta neutra">Histórico</span></td></tr>`).join('')}
          ${s.historico.length || (s.pagos_fora || []).length ? '' : '<tr><td colspan="6">Primeira solicitação deste benefício.</td></tr>'}
        </table></div>
      </div>
      <div class="det-bloco">
        <h4>Controle do limite</h4>
        <div class="cartao" style="padding:1rem">
          <div class="saldo">
            <span class="saldo-topo"><span>Limite (${esc(TEXTO_ESCOPO[sal.escopo])})</span><strong>${reais(sal.limite)}</strong></span>
            <span class="saldo-topo"><span>Já comprometido em outras solicitações${sal.historico ? ` <small>(inclui ${reais(sal.historico)} pagos fora do portal)</small>` : ''}</span><strong>${reais(sal.usado)}</strong></span>
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
        <form class="comentario" id="form-comentario">
          <h4>Comentar</h4>
          <textarea class="campo" name="texto" rows="2" maxlength="1000" placeholder="Ex.: pedi ao colaborador a nota fiscal legível por e-mail."></textarea>
          <div class="linha-form" style="margin-top:0;align-items:center">
            <label class="check"><input type="checkbox" name="visivel"> Visível para o colaborador</label>
            <button class="btn btn-claro btn-sm" type="submit" style="margin-left:auto">💬 Comentar</button>
          </div>
          <small class="q-dica">Sem marcar, o comentário é interno: só o RH e o administrador veem.</small>
        </form>
        <h4>Rastreabilidade</h4>
        <ol class="linha-tempo">${s.eventos.map(ev => `<li class="${ev.interno ? 'interno' : ''}"><strong>${esc(ev.evento)}${ev.evento === 'Comentário do RH' ? ` <span class="etiqueta ${ev.interno ? 'neutra' : 'ok'}">${ev.interno ? 'interno' : 'visível ao colaborador'}</span>` : ''}</strong><small>${dataHoraBR(ev.em)}${ev.por ? ` · ${esc(ev.por)}` : ''}</small>${ev.detalhe ? `<p>${esc(ev.detalhe)}</p>` : ''}</li>`).join('')}</ol>
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
  document.getElementById('form-comentario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.texto.value.trim().length < 3) { f.texto.focus(); return toast('Escreva o comentário.', 'erro'); }
    try {
      await api(`/api/admin/solicitacoes/${s.id}/comentar`, { method: 'POST', body: { texto: f.texto.value, visivel_colaborador: f.visivel.checked } });
      toast(f.visivel.checked ? 'Comentário enviado ao colaborador.' : 'Comentário interno registrado.');
      abrirAnalise(s.id);
    } catch (err) { toast(err.message, 'erro'); }
  });
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
    <tr><th>Matrícula</th><th>Colaborador</th><th>CPF</th><th>Unidade</th><th>Benefício</th><th>Beneficiário</th><th>Valor aprovado</th><th>Verba</th><th>Aprovação</th></tr>
    ${d.linhas.map(l => `<tr><td>${esc(l.matricula)}</td><td>${esc(l.nome)}</td><td>${formatarCpf(l.cpf)}</td><td>${esc(l.unidade)}</td>
      <td>${esc(l.beneficio)}</td><td>${esc(l.beneficiario)}<br><small class="q-dica">${esc(l.parentesco)}</small></td><td><strong>${reais(l.valor_aprovado)}</strong></td>
      <td>${esc(l.verba) || '<span class="q-dica">definir</span>'}</td><td>${dataBR(l.data_aprovacao)}</td></tr>`).join('') || '<tr><td colspan="10">Nenhuma solicitação aprovada nesta competência.</td></tr>'}`;
}
document.getElementById('folha-comp').addEventListener('change', () => carregarFolha().catch(err => toast(err.message, 'erro')));
document.getElementById('folha-xlsx').addEventListener('click', () => {
  const d = adm.folha;
  if (!d) return;
  baixarExcel(d.linhas.map(l => ({
    'Matrícula': l.matricula, 'Nome do colaborador': l.nome, CPF: l.cpf, 'Unidade/lotação': l.unidade,
    Benefício: l.beneficio, Beneficiário: l.beneficiario, Parentesco: l.parentesco, Competência: competenciaBR(l.competencia),
    'Valor aprovado': l.valor_aprovado / 100, 'Verba de folha': l.verba, 'Data da aprovação': dataBR(l.data_aprovacao),
    'Aprovado por': l.aprovado_por, Protocolo: l.protocolo, Status: l.status,
  })), 'Folha', `reembolsos-folha-${d.competencia}.xlsx`);
});

// ---------- Recadastramento anual (Educacional e Creche/Babá) ----------
const SIT_RECAD = { pendente: ['nao', 'Pendente de envio'], analise: ['pend', 'Em análise'], aprovado: ['ok', 'Aprovado'], reprovado: ['nao', 'Reprovado'] };
let recad = null;

/** Busca a lista do ano e atualiza o contador do menu (envios aguardando análise). */
async function atualizarRecadastro() {
  recad = await api('/api/admin/recadastros');
  const q = document.getElementById('qtd-recad');
  q.hidden = !recad.resumo.analise;
  q.textContent = recad.resumo.analise;
  return recad;
}

async function carregarRecadastro() {
  await atualizarRecadastro();
  const c = recad.campanha;
  document.getElementById('rc-campanha').innerHTML = !c.ativo
    ? '<div class="alerta aviso">📑 <span>O recadastramento anual está desativado (Administração → Período e benefícios).</span></div>'
    : `<div class="faixa-periodo ${c.exigido ? '' : 'fechado'}"><span class="ponto"></span><span><strong>Recadastramento ${c.ano}.</strong> ${c.exigido
      ? `Exigido desde ${dataBR(c.inicio)}: Educacional e Creche/Babá ficam bloqueados para quem não tiver os documentos aprovados.`
      : `Começa em ${dataBR(c.inicio)}. Até lá, as solicitações seguem normalmente e o envio de documentos ainda não está aberto.`}</span></div>`;
  const r = recad.resumo;
  document.getElementById('rc-kpis').innerHTML = [
    kpi('⏳', fmt(r.analise), 'em análise', 'aguardando o RH'),
    kpi('📭', fmt(r.pendente), 'pendentes de envio', c.exigido ? 'bloqueados no portal' : ''),
    kpi('↩️', fmt(r.reprovado), 'reprovados', 'aguardando reenvio'),
    kpi('✅', fmt(r.aprovado), 'aprovados', r.total ? `${Math.round((r.aprovado / r.total) * 100)}% de ${fmt(r.total)} beneficiários` : ''),
  ].join('');
  renderRecadastroLista();
}

function listaRecadastroFiltrada() {
  const st = document.getElementById('rc-status').value;
  const bn = document.getElementById('rc-beneficio').value;
  const termo = semAcento(document.getElementById('rc-busca').value);
  return (recad?.itens || []).filter(i => (!st || i.status === st) && (!bn || i.beneficio === bn)
    && (!termo || semAcento([i.titular, i.nome, i.matricula, i.unidade].join(' ')).includes(termo) || i.cpf.includes(termo.replace(/\D/g, '') || '#')));
}

function renderRecadastroLista() {
  const lista = listaRecadastroFiltrada();
  document.getElementById('rc-resumo').textContent = `· ${fmt(lista.length)} de ${fmt(recad.itens.length)}`;
  document.getElementById('rc-tabela').innerHTML = `
    <tr><th>Colaborador</th><th>Beneficiário</th><th>Benefício</th><th>Situação</th><th></th></tr>
    ${lista.slice(0, 1000).map(i => {
      const [cl, rot] = SIT_RECAD[i.status];
      return `<tr>
        <td><strong>${esc(i.titular)}</strong><br><small class="q-dica">Mat. ${esc(i.matricula)}${i.unidade ? ` · ${esc(i.unidade)}` : ''}</small></td>
        <td>${esc(i.nome)}<br><small class="q-dica">${esc(i.rotulo)}${i.idade ? ` · ${esc(i.idade)}` : ''}</small></td>
        <td>${i.icone} ${esc(i.beneficio_nome.replace('Reembolso ', ''))}</td>
        <td><span class="etiqueta ${cl}">${rot}</span>${i.origem === 'manual' ? ' <small class="q-dica">(liberado sem envio)</small>' : ''}
          <br><small class="q-dica">${i.analisado_em ? `analisado em ${dataHoraBR(i.analisado_em)}` : i.enviado_em ? `enviado em ${dataHoraBR(i.enviado_em)}` : ''}</small></td>
        <td class="acoes-colab">
          ${i.id && i.origem !== 'manual' ? `<button class="btn ${i.status === 'analise' ? 'btn-laranja' : 'btn-claro'} btn-sm" data-recad="${i.id}">${i.status === 'analise' ? 'Analisar' : 'Ver'}</button>` : ''}
          ${i.status === 'pendente' || i.status === 'reprovado' ? `<button class="btn btn-claro btn-sm" data-liberar-recad='${esc(JSON.stringify({ cpf: i.cpf, dependente_id: i.dependente_id, beneficio: i.beneficio, nome: i.nome, beneficio_nome: i.beneficio_nome }))}'>Liberar sem envio</button>` : ''}
        </td></tr>`;
    }).join('') || '<tr><td colspan="5" class="q-dica">Nenhum beneficiário nesta situação.</td></tr>'}`;
}
['rc-status', 'rc-beneficio'].forEach(id => document.getElementById(id).addEventListener('change', renderRecadastroLista));
document.getElementById('rc-busca').addEventListener('input', renderRecadastroLista);
document.getElementById('rc-exportar').addEventListener('click', () => baixarExcel(listaRecadastroFiltrada().map(i => ({
  Colaborador: i.titular, Matrícula: i.matricula, CPF: formatarCpf(i.cpf), Unidade: i.unidade || '', 'E-mail': i.email || '',
  Beneficiário: i.nome, Vínculo: i.rotulo, Idade: i.idade || '', Benefício: i.beneficio_nome, Situação: SIT_RECAD[i.status][1],
  'Enviado em': i.enviado_em ? dataHoraBR(i.enviado_em) : '', 'Analisado em': i.analisado_em ? dataHoraBR(i.analisado_em) : '', Observação: i.observacao_rh || '',
})), 'Recadastramento', `recadastramento-${recad.campanha.ano}.xlsx`));

document.getElementById('rc-tabela').addEventListener('click', (e) => {
  const v = e.target.closest('[data-recad]');
  if (v) { abrirRecadastro(Number(v.dataset.recad)).catch(err => toast(err.message, 'erro')); return; }
  const l = e.target.closest('[data-liberar-recad]');
  if (!l) return;
  const i = JSON.parse(l.dataset.liberarRecad);
  const f = document.getElementById('form-liberar-recad');
  f.reset();
  f.dataset.item = l.dataset.liberarRecad;
  document.getElementById('lib-titulo').textContent = `Liberar ${i.nome}`;
  document.getElementById('lib-texto').textContent = `Aprova o recadastramento ${recad.campanha.ano} de ${i.nome} (${i.beneficio_nome}) sem envio pelo portal. Use quando os documentos chegaram por outro meio.`;
  document.getElementById('modal-liberar-recad').showModal();
});
document.getElementById('form-liberar-recad').addEventListener('submit', async (e) => {
  e.preventDefault();
  const i = JSON.parse(e.target.dataset.item);
  try {
    await api('/api/admin/recadastros/liberar', { method: 'POST', body: { cpf: i.cpf, dependente_id: i.dependente_id, beneficio: i.beneficio, motivo: e.target.motivo.value } });
    document.getElementById('modal-liberar-recad').close();
    toast(`${i.nome.split(' ')[0]} liberado(a) para solicitar reembolsos.`);
    carregarRecadastro();
  } catch (err) { toast(err.message, 'erro'); }
});

async function abrirRecadastro(id) {
  const r = await api(`/api/admin/recadastros/${id}`);
  const [cl, rot] = SIT_RECAD[r.status];
  document.getElementById('an-protocolo').textContent = `RECADASTRAMENTO ANUAL ${r.ano}`;
  document.getElementById('an-titulo').innerHTML = `${ICONES[r.beneficio] || ''} ${esc(r.beneficio_nome)} <span class="etiqueta ${cl}">${rot}</span>`;
  const enviados = new Set(r.anexos.map(a => a.tipo_nome));
  const faltando = r.documentos_exigidos.filter(d => !enviados.has(d));
  document.getElementById('an-corpo').innerHTML = `
    <div class="det-grade">
      <div class="det-bloco">
        <h4>Colaborador</h4>
        <dl class="dados-cad">
          <div><dt>Nome</dt><dd>${esc(r.colaborador.nome || '')}</dd></div>
          <div><dt>Matrícula</dt><dd>${esc(r.colaborador.matricula || '')}</dd></div>
          <div><dt>CPF</dt><dd>${formatarCpf(r.cpf)}</dd></div>
          <div><dt>Unidade</dt><dd>${esc(r.colaborador.unidade || '–')}</dd></div>
        </dl>
        <h4 style="margin-top:.4rem">Beneficiário</h4>
        <dl class="dados-cad">
          <div><dt>Nome</dt><dd>${esc(r.beneficiario_nome)}<br><small style="font-weight:400">${esc(r.rotulo)}</small></dd></div>
          <div><dt>Nascimento</dt><dd>${r.data_nascimento ? `${dataBR(r.data_nascimento)}<br><small style="font-weight:400">${esc(r.idade || '')}</small>` : '–'}</dd></div>
          <div><dt>Modalidade</dt><dd>${esc(r.modalidade_nome || '–')}</dd></div>
          <div><dt>Enviado em</dt><dd>${dataHoraBR(r.enviado_em)}</dd></div>
        </dl>
        <h4 style="margin-top:.4rem">Documentos <small style="text-transform:none;letter-spacing:0;color:var(--texto-suave);font-weight:400">· exigidos: ${esc(r.documentos_exigidos.join(' + '))}</small></h4>
        ${faltando.length ? `<div class="alerta erro" style="margin:0">⚠️ Faltando: ${esc(faltando.join(', '))}</div>` : ''}
        <div class="anexos-lista">${r.anexos.map(a => `<a href="/api/recadastro/anexos/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.tipo_nome)} · ${esc(a.nome_original)}<small>${tamanhoArquivo(a.tamanho)}</small></a>`).join('')}</div>
        <p class="q-dica" style="margin:.4rem 0 0">Confira se o contrato é do ano de ${r.ano} e está em nome do responsável legal.</p>
        ${r.historico.length ? `<h4 style="margin-top:.8rem">Envios anteriores</h4>
          <div class="tabela-wrap"><table class="tabela"><tr><th>Ano</th><th>Situação</th><th>Data</th><th>Observação</th></tr>
          ${r.historico.map(h => `<tr><td>${h.ano}</td><td><span class="etiqueta ${SIT_RECAD[h.status][0]}">${SIT_RECAD[h.status][1]}</span></td><td>${dataHoraBR(h.analisado_em || h.enviado_em)}</td><td>${esc(h.observacao_rh || '')}</td></tr>`).join('')}
          </table></div>` : ''}
      </div>
      <div class="det-bloco">
        <form class="decisao" id="form-recad-decisao">
          <h4>${r.status === 'analise' ? 'Decisão' : 'Decisão registrada'}</h4>
          ${r.status !== 'analise' ? `<p style="margin:0"><span class="etiqueta ${cl}">${rot}</span> <small class="q-dica">por ${esc(r.analisado_por || '–')} em ${dataHoraBR(r.analisado_em)}</small></p>${r.observacao_rh ? `<p class="pre" style="margin:0">${esc(r.observacao_rh)}</p>` : ''}` : ''}
          <label class="rotulo">${r.status === 'analise' ? 'Observação' : 'Rever a decisão: observação'} <small>(obrigatória para reprovar; o colaborador verá este texto)</small>
            <textarea class="campo" name="observacao" rows="3" maxlength="1000" placeholder="Ex.: o contrato enviado é de 2026; envie o de ${r.ano}."></textarea>
          </label>
          <div class="linha-form" style="justify-content:flex-end">
            ${r.status !== 'reprovado' ? '<button class="btn btn-perigo" type="button" data-recad-decisao="reprovado">Reprovar</button>' : ''}
            ${r.status !== 'aprovado' ? '<button class="btn btn-laranja" type="button" data-recad-decisao="aprovado">Aprovar e liberar</button>' : ''}
          </div>
          <small class="q-dica">Aprovado: as solicitações de ${esc(r.beneficio_nome.replace('Reembolso ', ''))} deste beneficiário ficam liberadas no portal. Reprovado: continuam bloqueadas até um novo envio.</small>
        </form>
      </div>
    </div>`;
  document.getElementById('form-recad-decisao').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-recad-decisao]');
    if (!b) return;
    const observacao = e.currentTarget.observacao.value;
    if (b.dataset.recadDecisao === 'reprovado' && !observacao.trim()) return toast('Informe o motivo da reprovação.', 'erro');
    try {
      await api(`/api/admin/recadastros/${r.id}/decidir`, { method: 'POST', body: { decisao: b.dataset.recadDecisao, observacao } });
      document.getElementById('modal-analise').close();
      toast(b.dataset.recadDecisao === 'aprovado' ? 'Recadastramento aprovado: beneficiário liberado.' : 'Recadastramento reprovado. O colaborador verá o motivo.');
      carregarRecadastro();
    } catch (err) { toast(err.message, 'erro'); }
  });
  document.getElementById('modal-analise').showModal();
}
