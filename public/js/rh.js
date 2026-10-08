// Área do RH: painel, análise das solicitações (aprovar, reprovar, reabrir e comentar) e relatório da folha.
const adm = { usuario: null, filtros: null, solicitacoes: [], folha: null };

const area = iniciarArea({
  exigeAdmin: false,
  abaPadrao: 'painel',
  abas: { painel: carregarPainel, solicitacoes: carregarSolicitacoes, folha: carregarFolha },
  aoEntrar: async (usuario) => { adm.usuario = usuario; await carregarFiltros(); },
});
const trocarAba = (aba) => area.trocarAba(aba);

async function carregarFiltros() {
  adm.filtros = await api('/api/admin/filtros');
  const f = adm.filtros;
  const opcoesComp = f.competencias.map(c => `<option value="${c}">${competenciaBR(c)}</option>`).join('');
  document.getElementById('painel-comp').innerHTML = opcoesComp;
  document.getElementById('folha-comp').innerHTML = opcoesComp;
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
