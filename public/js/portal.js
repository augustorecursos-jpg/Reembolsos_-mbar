// Portal do colaborador: painel, benefícios elegíveis com saldo, nova solicitação e acompanhamento.
const estado = { me: null, solicitacoes: [] };
const conteudo = document.getElementById('conteudo');

async function carregar() {
  try {
    const [me, sols] = await Promise.all([api('/api/me'), api('/api/solicitacoes')]);
    estado.me = me;
    estado.solicitacoes = sols;
  } catch (err) {
    if (err.status === 401) { location.href = 'index.html#acesso'; return false; }
    throw err;
  }
  const c = estado.me.colaborador;
  document.getElementById('nome-usuario').textContent = c.nome;
  document.getElementById('cargo-usuario').textContent = [`Matrícula ${c.matricula}`, c.unidade].filter(Boolean).join(' · ');
  document.getElementById('avatar').textContent = c.nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const emAnalise = estado.solicitacoes.filter(s => s.status === 'analise').length;
  const qtd = document.getElementById('qtd-analise');
  qtd.hidden = !emAnalise;
  qtd.textContent = emAnalise;
  // Recadastramento anual: menu aparece para quem tem Educacional ou Creche/Babá; o número mostra as pendências.
  const rc = estado.me.recadastro || {};
  document.getElementById('menu-recadastro').hidden = !(rc.ativo && rc.total);
  const qr = document.getElementById('qtd-recad');
  qr.hidden = !(rc.ativo && rc.exigido && rc.pendentes);
  qr.textContent = rc.pendentes || '';
  return true;
}

const beneficio = (codigo) => estado.me.beneficios.find(b => b.codigo === codigo);
const pctUso = (usado, limite) => (limite ? Math.min(100, Math.round((usado / limite) * 100)) : 0);

/** Texto do escopo do limite: grupo familiar no mês, por dependente no mês ou por beneficiário em N meses. */
function textoEscopo(b) {
  if (b.escopo === 'familia_mes') return 'por mês, para todo o grupo familiar';
  if (b.escopo === 'dependente_mes') return 'por dependente, por mês';
  if (b.escopo === 'dependente_janela') return `por dependente, em ${(b.janela?.nomes || ['fevereiro', 'julho']).join(' e ')} (o saldo não acumula)`;
  return `por beneficiário, a cada ${b.periodo_meses} meses`;
}

/** Saldo disponível do benefício (soma dos saldos individuais, ou o saldo único da família). */
function saldoTotal(b) {
  if (b.escopo === 'familia_mes') return { disponivel: b.disponivel_familia, limite: b.limite };
  return {
    disponivel: b.beneficiarios.reduce((s, p) => s + p.disponivel, 0),
    limite: b.beneficiarios.reduce((s, p) => s + p.limite, 0),
  };
}

function renderLateral() {
  const rota = location.hash.match(/^#\/beneficio\/(\w+)/);
  const atual = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'painel';
  document.querySelectorAll('[data-rota]').forEach(b => b.classList.toggle('ativo', b.dataset.rota === atual));
  document.getElementById('lista-modulos').innerHTML = estado.me.beneficios.map(b => {
    const s = saldoTotal(b);
    const livre = s.limite ? Math.round((s.disponivel / s.limite) * 100) : 0;
    return `
    <button class="tema-lateral ${rota && rota[1] === b.codigo ? 'ativo' : ''}" data-beneficio="${b.codigo}">
      <span class="ic">${b.icone}</span>
      <span class="tema-lateral-txt">
        <strong>${esc(b.curto)}</strong>
        <small>Saldo ${reais(s.disponivel)}</small>
        <span class="mini-prog"><i style="width:${livre}%"></i></span>
      </span>
    </button>`;
  }).join('') || '<p class="lateral-grupo" style="color:#b9cddd;letter-spacing:0;font-weight:400">Nenhum benefício disponível.</p>';
}

function anelDias(p) {
  const r = 62, comp = 2 * Math.PI * r;
  const valor = Math.min(100, Math.round((p.dias_restantes / Math.max(p.dias_ciclo, p.dias_restantes)) * 100));
  return `
    <div class="anel" role="img" aria-label="${p.dias_restantes} dias para o fechamento da competência">
      <svg viewBox="0 0 150 150">
        <circle class="trilho" cx="75" cy="75" r="${r}"/>
        <circle class="carga" cx="75" cy="75" r="${r}" stroke-dasharray="${comp}" stroke-dashoffset="${comp}" data-alvo="${comp * (1 - valor / 100)}"/>
      </svg>
      <div class="anel-texto"><strong>${p.dias_restantes}</strong><span>${p.dias_restantes === 1 ? 'DIA PARA O FECHAMENTO' : 'DIAS PARA O FECHAMENTO'}</span></div>
    </div>`;
}

const ONDA_CARTAO = `
  <svg class="onda" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
    <path d="M400 40C300 50 220 150 90 200H130C250 160 320 70 400 62Z" fill="#ec6b24"/>
    <path d="M400 62C320 70 250 160 130 200H400Z" fill="#164d74"/>
  </svg>`;

function textoPeriodo(p) {
  return `Competência ${competenciaBR(p.competencia)}: envios de ${dataBR(p.inicio_ciclo)} a ${dataBR(p.encerra_em)}${p.dias_restantes === 1 ? ' (fecha hoje)' : ''}. A partir de ${dataBR(somarDiaISO(p.encerra_em))}, entram na competência ${competenciaBR(p.proxima_competencia)}.`;
}
const somarDiaISO = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);

function faixaPeriodo() {
  const p = estado.me.periodo;
  return `<div class="faixa-periodo"><span class="ponto"></span><span><strong>Envios abertos.</strong> ${esc(textoPeriodo(p))}</span></div>`;
}

function cartaoBeneficio(b) {
  const s = saldoTotal(b);
  let saldoHtml;
  if (b.escopo === 'familia_mes') {
    saldoHtml = `
      <span class="saldo">
        <span class="saldo-topo"><span>Saldo do grupo familiar</span><strong>${reais(s.disponivel)}</strong></span>
        <span class="barra-prog ${s.disponivel ? '' : 'saldo-zero'}"><i style="width:${pctUso(s.limite - s.disponivel, s.limite)}%"></i></span>
        <span>${reais(s.limite - s.disponivel)} utilizados de ${reais(s.limite)} nesta competência</span>
      </span>`;
  } else {
    saldoHtml = `<span class="beneficiarios-mini">${b.beneficiarios.map(p => `
      <span><span>${esc(p.nome.split(' ')[0])} <small>· ${esc(p.rotulo)}</small></span><b>${reais(p.disponivel)}</b></span>
      <span class="barra-prog ${p.disponivel ? '' : 'saldo-zero'}"><i style="width:${pctUso(p.usado, p.limite)}%"></i></span>`).join('')}
    </span>`;
  }
  return `
    <button class="tema" data-beneficio="${b.codigo}">
      <span class="tema-topo"><span class="ic">${b.icone}</span><strong>${esc(b.nome)}</strong></span>
      <span class="tema-meta">Limite de ${reais(b.limite)} ${textoEscopo(b)}</span>
      ${saldoHtml}
      <span class="tema-acao"><span class="etiqueta ${s.disponivel ? 'ok' : 'neutra'}">${s.disponivel ? 'Saldo disponível' : b.janela && !b.janela.aberta ? `Abre em ${dataBR(b.janela.proxima_inicio)}` : 'Limite atingido'}</span><span class="tema-cta">Ver detalhes →</span></span>
    </button>`;
}

function itemSolicitacao(s) {
  const b = beneficio(s.beneficio) || { icone: '📄' };
  const icones = { medicamento: '💊', educacional: '🎒', creche: '🧸', oculos: '👓', material: '✏️' };
  return `
    <button class="sol-item" data-sol="${s.id}">
      <span class="ic">${icones[s.beneficio] || b.icone}</span>
      <span><strong>${esc(s.beneficio_nome)}</strong><small>${esc(s.beneficiario_nome)} · ${esc(s.beneficiario_rotulo)} · ${esc(s.protocolo)} · ${competenciaBR(s.competencia)}</small></span>
      <span class="valor">${reais(s.status === 'aprovado' ? s.valor_aprovado : s.valor_solicitado)}${etiquetaStatus(s.status)}</span>
      ${s.status === 'reprovado' && s.observacao_rh ? `<p class="obs"><strong>Motivo:</strong> ${esc(s.observacao_rh)}</p>` : ''}
    </button>`;
}

/** Faixa no painel sobre o recadastramento anual (antes do início, ou com pendências). */
function avisoRecadastro(rc) {
  if (!rc || !rc.ativo || !rc.total) return '';
  if (!rc.exigido) {
    return `<div class="alerta aviso aviso-recad">📑 <span><strong>Recadastramento anual ${rc.ano}:</strong> a partir de ${dataBR(rc.inicio)}, os reembolsos de Educacional e Creche/Babá só serão liberados após o envio e a aprovação do contrato atualizado. <a href="#/recadastro">Saiba mais →</a></span></div>`;
  }
  if (rc.pendentes) {
    return `<div class="alerta erro aviso-recad">📑 <span><strong>Recadastramento anual ${rc.ano} pendente</strong> para ${rc.pendentes} beneficiário(s). Os reembolsos de Educacional e Creche/Babá estão bloqueados até o envio e a aprovação dos documentos. <a href="#/recadastro">Enviar documentos →</a></span></div>`;
  }
  if (rc.em_analise) return `<div class="alerta aviso aviso-recad">📑 <span><strong>Recadastramento anual ${rc.ano}:</strong> ${rc.em_analise} envio(s) em análise pelo RH. <a href="#/recadastro">Acompanhar →</a></span></div>`;
  return '';
}

// ---------- Recadastramento anual ----------

const ROTULOS_RECAD = { pendente: ['nao', 'Pendente de envio'], analise: ['pend', 'Em análise'], aprovado: ['ok', 'Aprovado'], reprovado: ['nao', 'Reprovado'] };

async function renderRecadastro() {
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  const d = await api('/api/recadastro');
  const c = d.campanha;
  const docsDe = (mod) => d.modalidades[mod].documentos.map(x => d.documentos[x]);
  conteudo.innerHTML = `
    <h1 class="titulo-pagina">Recadastramento <em>anual ${c.ano}</em></h1>
    <div class="cartao recad-intro">
      <p>Para manter os reembolsos de <strong>Educacional</strong> e <strong>Creche/Babá</strong>, envie todo ano o contrato atualizado de cada beneficiário.
        ${c.exigido
          ? 'Enquanto o recadastramento não for <strong>aprovado pelo RH</strong>, as solicitações desse beneficiário ficam bloqueadas.'
          : `A partir de <strong>${dataBR(c.inicio)}</strong>, as solicitações só serão liberadas após o envio e a aprovação dos documentos. O envio abre nessa data.`}</p>
      <div class="recad-docs">
        <div><strong>🎒 Educacional</strong><ul>${docsDe('escola').map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><strong>🧸 Creche</strong><ul>${docsDe('creche').map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><strong>🧸 Babá</strong><ul>${docsDe('baba').map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
    </div>
    <div class="recad-lista">
      ${d.itens.map(i => cartaoRecadastro(i, d, c)).join('') || '<div class="cartao vazio-bloco"><span>📑</span>Nenhum beneficiário de Educacional ou Creche/Babá no seu cadastro.</div>'}
    </div>`;
  conteudo.querySelectorAll('form.form-recad').forEach(ligarFormRecadastro);
}

function cartaoRecadastro(i, d, c) {
  const [classe, rotulo] = ROTULOS_RECAD[i.status];
  const podeEnviar = c.exigido && (i.status === 'pendente' || i.status === 'reprovado');
  const modsPossiveis = Object.entries(d.modalidades).filter(([, m]) => m.beneficio === i.beneficio);
  let corpo = '';
  if (i.status === 'aprovado') corpo = `<p class="q-dica">${i.origem === 'manual' ? 'Liberado pelo RH' : 'Documentos aprovados'} em ${dataHoraBR(i.analisado_em)}. As solicitações deste beneficiário estão liberadas.</p>`;
  if (i.status === 'analise') corpo = `<p class="q-dica">Enviado em ${dataHoraBR(i.enviado_em)}. Aguardando a análise do RH.</p>`;
  if (i.status === 'reprovado') corpo = `<div class="alerta erro" style="margin:0 0 .8rem">⚠️ <span><strong>Motivo da reprovação:</strong> ${esc(i.observacao_rh || '')}</span></div>`;
  if (i.anexos.length && i.status !== 'reprovado') corpo += `<div class="anexos-lista" style="margin-top:.6rem">${i.anexos.map(a => `<a href="/api/recadastro/anexos/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.tipo_nome)} · ${esc(a.nome_original)}</a>`).join('')}</div>`;
  if (i.status === 'pendente' && !c.exigido) corpo = `<p class="q-dica">O envio abre em ${dataBR(c.inicio)}.</p>`;
  if (podeEnviar) {
    const campo = (tipo, nome, obrig) => `<label class="anexo-campo" data-doc="${tipo}"><input type="file" name="${tipo}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" ${tipo === 'outro' ? 'multiple' : ''}>
      <strong>📎 ${esc(nome)} ${obrig ? '<em>*</em>' : '<small>(opcional)</small>'}</strong><small data-nome>Clique ou arraste o arquivo aqui</small></label>`;
    corpo += `
      <form class="form-recad" novalidate>
        <input type="hidden" name="beneficio" value="${i.beneficio}"><input type="hidden" name="beneficiario" value="${i.dependente_id}">
        ${modsPossiveis.length > 1 ? `<div class="recad-mod"><span class="rotulo">O reembolso é de</span>${modsPossiveis.map(([k, m], n) => `<label class="check"><input type="radio" name="modalidade" value="${k}" ${n === 0 ? 'checked' : ''}> ${esc(m.nome)}</label>`).join('')}</div>`
          : `<input type="hidden" name="modalidade" value="${modsPossiveis[0][0]}">`}
        ${modsPossiveis.map(([k, m], n) => `<div class="anexos-grade" data-mod="${k}" ${n === 0 ? '' : 'hidden'}>${m.documentos.map(x => campo(x, d.documentos[x], true)).join('')}</div>`).join('')}
        <div class="anexos-grade" style="margin-top:.8rem">${campo('outro', 'Outros documentos', false)}</div>
        <label class="declaracao" style="margin-top:1rem"><input type="checkbox" name="declaracao" value="sim"><span>Declaro que os documentos enviados são verdadeiros e referem-se ao ano de ${c.ano}.</span></label>
        <div class="recad-acoes"><span class="recad-erro" role="alert"></span><button class="btn btn-laranja" type="submit">${i.status === 'reprovado' ? 'Reenviar documentos' : 'Enviar documentos'}</button></div>
      </form>`;
  }
  return `
    <section class="cartao recad-item">
      <header><span class="ic">${i.icone}</span><div><strong>${esc(i.nome)}</strong><small>${esc(i.beneficio_nome)} · ${esc(i.rotulo)}${i.idade ? ` · ${esc(i.idade)}` : ''}</small></div>
        <span class="etiqueta ${classe}">${rotulo}</span></header>
      ${corpo}
    </section>`;
}

function ligarFormRecadastro(form) {
  const erro = form.querySelector('.recad-erro');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'modalidade') {
      // Troca de creche para babá: mostra só os documentos da modalidade escolhida (e limpa os da outra).
      form.querySelectorAll('[data-mod]').forEach(g => {
        const ativo = g.dataset.mod === e.target.value;
        g.hidden = !ativo;
        if (!ativo) g.querySelectorAll('input[type=file]').forEach(inp => { inp.value = ''; inp.dispatchEvent(new Event('change', { bubbles: true })); });
      });
    } else if (e.target.type === 'file') {
      const campo = e.target.closest('.anexo-campo');
      const nomes = [...e.target.files].map(f => `${f.name} (${tamanhoArquivo(f.size)})`);
      const grande = [...e.target.files].find(f => f.size > 10 * 1024 * 1024);
      campo.classList.toggle('ok', nomes.length > 0 && !grande);
      campo.querySelector('[data-nome]').textContent = grande ? `⚠️ ${grande.name} tem mais de 10 MB` : (nomes.join(', ') || 'Clique ou arraste o arquivo aqui');
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = '';
    const mod = (form.querySelector('[name=modalidade]:checked') || form.querySelector('[name=modalidade]')).value;
    const faltando = [...form.querySelectorAll(`[data-mod="${mod}"] .anexo-campo`)].filter(l => !l.querySelector('input').files.length).map(l => l.querySelector('strong').textContent.replace('📎', '').replace('*', '').trim());
    if (faltando.length) { erro.textContent = `Anexe: ${faltando.join(', ')}.`; return; }
    if (!form.declaracao.checked) { erro.textContent = 'Confirme a declaração para enviar.'; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/recadastro', { method: 'POST', body: new FormData(form) });
      toast('Documentos enviados! O RH vai analisar e você será avisado.');
      await carregar();
      renderLateral();
      await renderRecadastro();
    } catch (err) { erro.textContent = err.message; btn.disabled = false; }
  });
}

function renderPainel() {
  const { me } = estado;
  const p = me.periodo;
  const primeiroNome = me.colaborador.nome.split(' ')[0];
  const r = me.resumo;
  conteudo.innerHTML = `
    <section class="boasvindas">
      <div class="pontilhado"></div>${ONDA_CARTAO}
      <div>
        <small>MEUS REEMBOLSOS</small>
        <h1>Olá, ${esc(primeiroNome)}!</h1>
        <p>${esc(textoPeriodo(p))}</p>
        ${p.aberto && me.beneficios.length ? '<a class="btn btn-laranja" href="#/nova">Nova solicitação →</a>' : '<a class="btn btn-laranja" href="#/minhas">Minhas solicitações →</a>'}
      </div>
      ${anelDias(p)}
    </section>

    ${avisoRecadastro(me.recadastro)}
    <div class="indicadores">
      <div class="indicador destaque"><span class="ic">⏳</span><div><strong>${r.analise}</strong><span>em análise</span></div></div>
      <div class="indicador"><span class="ic">✅</span><div><strong>${r.aprovadas_ano}</strong><span>aprovadas em ${me.hoje.slice(0, 4)}</span></div></div>
      <div class="indicador destaque"><span class="ic">💰</span><div><strong>${reais(r.valor_ano)}</strong><span>reembolsado em ${me.hoje.slice(0, 4)}</span></div></div>
      <div class="indicador"><span class="ic">↩️</span><div><strong>${r.reprovadas_ano}</strong><span>reprovadas em ${me.hoje.slice(0, 4)}</span></div></div>
    </div>

    <div class="grade-painel">
      <section>
        <h2 class="titulo-secao">Meus benefícios <small>saldo da competência ${competenciaBR(p.competencia)}</small></h2>
        <div class="temas">
          ${me.beneficios.map(cartaoBeneficio).join('') || '<div class="cartao vazio-bloco"><span>🔎</span>Nenhum benefício de reembolso disponível para o seu cadastro. Em caso de dúvida, procure o time de RH.</div>'}
        </div>
      </section>
      <section>
        <h2 class="titulo-secao">Últimas solicitações</h2>
        <div class="cartao">
          ${estado.solicitacoes.length
            ? `<div class="lista-sol">${estado.solicitacoes.slice(0, 5).map(itemSolicitacao).join('')}</div>
               ${estado.solicitacoes.length > 5 ? '<p style="margin:.9rem 0 0;text-align:center"><a class="tema-cta" style="text-decoration:none" href="#/minhas">Ver todas →</a></p>' : ''}`
            : '<p class="vazio-bloco"><span>🧾</span>Você ainda não enviou solicitações de reembolso.</p>'}
        </div>
      </section>
    </div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const arco = conteudo.querySelector('.anel .carga');
    if (arco) arco.style.strokeDashoffset = arco.dataset.alvo;
  }));
}

function renderBeneficio(codigo) {
  const b = beneficio(codigo);
  if (!b) { location.hash = '#/painel'; return; }
  const p = estado.me.periodo;
  const s = saldoTotal(b);
  conteudo.innerHTML = `
    <button class="voltar" data-voltar>← Voltar ao painel</button>
    <div class="tema-cab">
      <span class="ic">${b.icone}</span>
      <div><h1 class="titulo-pagina" style="margin:0">${esc(b.nome)}</h1><p>Limite de ${reais(b.limite)} ${textoEscopo(b)}</p></div>
      <div class="progresso">
        <span>Saldo disponível: <strong style="color:var(--marinho)">${reais(s.disponivel)}</strong></span>
        <span class="barra-prog ${s.disponivel ? '' : 'saldo-zero'}"><i style="width:${pctUso(s.limite - s.disponivel, s.limite)}%"></i></span>
      </div>
    </div>
    ${faixaPeriodo()}
    <div class="regras-grade">
      <div class="cartao"><h3>👥 Quem pode usar</h3><p>${esc(b.elegiveis)}</p></div>
      <div class="cartao"><h3>📎 Documentos obrigatórios</h3><ul>${b.documentos.map(d => `<li>${esc(d.nome)}</li>`).join('')}</ul></div>
      <div class="cartao"><h3>📅 Prazos</h3><p>Envio em qualquer dia. Cada competência vai do dia ${String(p.dia_inicio).padStart(2, '0')} ao dia ${String(p.dia_fim).padStart(2, '0')} do mês seguinte, com documentos emitidos há até ${estado.me.prazo_documento_dias} dias.</p></div>
      <div class="cartao"><h3>ℹ️ Atenção</h3><p>${esc(b.observacao)}</p></div>
    </div>
    <h2 class="titulo-secao">Beneficiários elegíveis <small>e saldo de cada um</small></h2>
    <div class="cartao">
      <div class="tabela-wrap"><table class="tabela">
        <tr><th>Beneficiário</th><th>Vínculo</th><th>Limite</th><th>Utilizado</th><th>Disponível</th><th></th></tr>
        ${b.beneficiarios.map(x => `
          <tr><td><strong style="color:var(--marinho)">${esc(x.nome)}</strong></td><td>${esc(x.rotulo)}</td><td>${reais(x.limite)}</td><td>${reais(x.usado)}</td>
          <td><strong>${reais(x.disponivel)}</strong></td>
          <td>${p.aberto && x.disponivel ? `<a class="btn btn-laranja btn-sm" href="#/nova/${b.codigo}/${x.id}">Solicitar</a>` : ''}</td></tr>`).join('')}
      </table></div>
      ${b.escopo === 'familia_mes' ? '<p class="q-dica" style="margin:.8rem 0 0">O limite é compartilhado: o valor utilizado por qualquer pessoa do grupo familiar reduz o saldo de todos no mês.</p>' : ''}
      ${b.escopo === 'dependente_janela' ? `<p class="q-dica" style="margin:.8rem 0 0">Um reembolso por dependente em cada competência de solicitação (${esc(b.janela.nomes.join(' e '))}). O valor não utilizado não acumula para a seguinte.${b.janela.aberta ? '' : ` Próxima: competência <strong>${esc(b.janela.proxima_nome)}</strong>, com envios a partir de <strong>${dataBR(b.janela.proxima_inicio)}</strong>.`}</p>` : ''}
      ${b.beneficiarios.some(x => x.bloqueio) && (!b.janela || b.janela.aberta) ? `<ul class="q-dica" style="margin:.5rem 0 0">${b.beneficiarios.filter(x => x.bloqueio).map(x => `<li>${esc(x.nome.split(' ')[0])}: ${esc(x.bloqueio)}</li>`).join('')}</ul>` : ''}
      ${b.beneficiarios.some(x => x.historico?.length) ? `<p class="q-dica" style="margin:.6rem 0 0">Reembolsos pagos antes do portal e considerados no saldo: ${b.beneficiarios.filter(x => x.historico?.length).map(x => x.historico.map(h => `${esc(x.nome.split(' ')[0])} — ${reais(h.valor)} em ${dataBR(h.data_pagamento)}`).join('; ')).join('; ')}.</p>` : ''}
    </div>
    <h2 class="titulo-secao">Histórico deste benefício</h2>
    <div class="cartao">
      ${(() => {
        const lista = estado.solicitacoes.filter(x => x.beneficio === codigo);
        return lista.length ? `<div class="lista-sol">${lista.map(itemSolicitacao).join('')}</div>` : '<p class="vazio-bloco"><span>🧾</span>Nenhuma solicitação deste benefício ainda.</p>';
      })()}
    </div>`;
}

// ---------- Nova solicitação ----------

/** Motivo curto para o beneficiário sem saldo (material escolar: fora da janela ou já solicitado nela). */
function motivoSemSaldo(b, x) {
  if (x.recadastro) return { pendente: 'recadastramento anual pendente', analise: 'recadastramento em análise', reprovado: 'recadastramento reprovado' }[x.recadastro];
  if (x.libera_em && !b.janela) return `limite usado · novo saldo em ${dataBR(x.libera_em)}`;
  if (!x.bloqueio || !b.janela) return 'limite atingido';
  return b.janela.aberta ? `já solicitado · próximo a partir de ${dataBR(b.janela.proxima_inicio)}` : `disponível a partir de ${dataBR(b.janela.proxima_inicio)}`;
}

function opcaoBeneficiario(b, x, marcado) {
  const semSaldo = !x.disponivel;
  return `
    <label class="opcao-cartao">
      <input type="radio" name="beneficiario" value="${x.id}" ${marcado ? 'checked' : ''} ${semSaldo ? 'disabled' : ''}>
      <span><span class="ic">${x.tipo === 'titular' ? '🙋' : '👤'}</span><span>
        <strong>${esc(x.nome)}</strong>
        <small>${esc(x.rotulo)} · ${semSaldo ? esc(motivoSemSaldo(b, x)) : `saldo ${reais(x.disponivel)}`}</small>
      </span></span>
    </label>`;
}

function declaracaoTexto(codigo) {
  const base = 'Declaro que as informações e os documentos enviados são verdadeiros e referem-se a despesa efetivamente paga, e que não solicitei o reembolso desta despesa por outro meio.';
  if (codigo === 'medicamento') return `${base} Declaro também que os itens são medicamentos e não incluem produtos de estética, beleza, higiene pessoal ou suplementos.`;
  if (codigo === 'educacional') return `${base} Declaro também que o dependente está matriculado e cursando o nível de ensino informado.`;
  return base;
}

function renderNova(codigoInicial, beneficiarioInicial) {
  const { me } = estado;
  const p = me.periodo;
  const c = me.colaborador;
  if (!me.beneficios.length) {
    conteudo.innerHTML = `<h1 class="titulo-pagina">Nova <em>solicitação</em></h1>
      <div class="cartao vazio-bloco"><span>🔎</span>Nenhum benefício de reembolso disponível para o seu cadastro. Em caso de dúvida, procure o time de RH.</div>`;
    return;
  }
  const hoje = me.hoje;
  const minimo = new Date(Date.parse(`${hoje}T12:00:00Z`) - me.prazo_documento_dias * 86400e3).toISOString().slice(0, 10);
  conteudo.innerHTML = `
    <h1 class="titulo-pagina">Nova <em>solicitação</em></h1>
    ${faixaPeriodo()}
    <form class="form-sol" id="form-sol" novalidate>
      <fieldset class="passo" ${p.aberto ? '' : 'disabled'}>
        <span class="passo-num">1</span>
        <legend>Benefício<small>Aparecem apenas os benefícios aos quais você tem direito.</small></legend>
        <div class="opcoes-cartao">
          ${me.beneficios.map(b => {
            const s = saldoTotal(b);
            return `
            <label class="opcao-cartao">
              <input type="radio" name="beneficio" value="${b.codigo}" ${b.codigo === codigoInicial ? 'checked' : ''}>
              <span><span class="ic">${b.icone}</span><span><strong>${esc(b.nome)}</strong><small>Saldo ${reais(s.disponivel)}</small></span></span>
            </label>`;
          }).join('')}
        </div>
      </fieldset>

      <fieldset class="passo desabilitado" id="passo-beneficiario" disabled>
        <span class="passo-num">2</span>
        <legend>Beneficiário da despesa<small id="dica-beneficiario">Selecione o benefício primeiro.</small></legend>
        <div class="opcoes-cartao" id="lista-beneficiarios"></div>
      </fieldset>

      <fieldset class="passo desabilitado" id="passo-despesa" disabled>
        <span class="passo-num">3</span>
        <legend>Dados da despesa<small>Documentos emitidos há até ${me.prazo_documento_dias} dias (a partir de ${dataBR(minimo)}).</small></legend>
        <div class="grade-campos">
          <label class="rotulo">Data de emissão do documento
            <input class="campo" type="date" name="data_documento" id="data-doc" max="${hoje}" required>
            <small>Data da nota fiscal ou do comprovante de pagamento.</small>
          </label>
          <label class="rotulo">Valor da despesa (R$)
            <input class="campo" name="valor" id="valor" inputmode="numeric" placeholder="0,00" autocomplete="off" required>
            <small id="dica-saldo">&nbsp;</small>
          </label>
          <label class="rotulo" id="campo-nivel" hidden>Nível de ensino
            <select class="campo" name="nivel_ensino" id="nivel-ensino">
              <option value="">Selecione…</option>
              ${me.niveis_ensino.map(n => `<option>${esc(n)}</option>`).join('')}
            </select>
          </label>
          <label class="rotulo largo">Descrição <small>(opcional)</small>
            <input class="campo" name="descricao" maxlength="500" placeholder="Ex.: mensalidade de outubro, armação e lentes, medicamentos da receita de 12/09…">
          </label>
        </div>
        <div id="alerta-despesa"></div>
      </fieldset>

      <fieldset class="passo desabilitado" id="passo-anexos" disabled>
        <span class="passo-num">4</span>
        <legend>Documentos<small>PDF, JPG ou PNG de até 10 MB cada. Os marcados com * são obrigatórios.</small></legend>
        <div class="anexos-grade" id="anexos"></div>
      </fieldset>

      <fieldset class="passo desabilitado" id="passo-confirmar" disabled>
        <span class="passo-num">5</span>
        <legend>Confirmação<small>Dados cadastrais preenchidos automaticamente a partir da base do RH.</small></legend>
        <dl class="dados-cad">
          <div><dt>Colaborador</dt><dd>${esc(c.nome)}</dd></div>
          <div><dt>Matrícula</dt><dd>${esc(c.matricula)}</dd></div>
          <div><dt>CPF</dt><dd>${formatarCpf(c.cpf)}</dd></div>
          <div><dt>Unidade / lotação</dt><dd>${esc(c.unidade || '–')}</dd></div>
          <div><dt>Competência</dt><dd>${competenciaBR(p.competencia)}</dd></div>
        </dl>
        <label class="declaracao" style="margin-top:1rem"><input type="checkbox" name="declaracao" value="sim" id="declaracao"><span id="texto-declaracao"></span></label>
        <div class="alerta erro" id="erro-envio" hidden></div>
        <div class="rodape-form" style="margin-top:1rem">
          <span class="resumo" id="resumo-envio"></span>
          <button class="btn btn-laranja" type="submit" id="btn-enviar">Enviar solicitação</button>
        </div>
      </fieldset>
    </form>`;

  const form = document.getElementById('form-sol');
  const campoValor = document.getElementById('valor');
  const campoData = document.getElementById('data-doc');
  let saldoAtual = null;

  // Máscara de moeda: os dígitos digitados viram centavos.
  campoValor.addEventListener('input', () => {
    const d = campoValor.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
    campoValor.value = d ? (Number(d) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    validarDespesa();
  });
  const centavos = () => Number(campoValor.value.replace(/\D/g, '')) || 0;

  const selecionado = (nome) => form.querySelector(`input[name="${nome}"]:checked`)?.value;

  function habilitar(id, sim) {
    const el = document.getElementById(id);
    el.disabled = !sim || !p.aberto;
    el.classList.toggle('desabilitado', !sim);
  }

  function aoEscolherBeneficio(preBeneficiario) {
    const b = beneficio(selecionado('beneficio'));
    if (!b) return;
    const lista = document.getElementById('lista-beneficiarios');
    const disponiveis = b.beneficiarios.filter(x => x.disponivel);
    const escolhido = preBeneficiario !== undefined ? Number(preBeneficiario) : (disponiveis.length === 1 ? disponiveis[0].id : null);
    lista.innerHTML = b.beneficiarios.map(x => opcaoBeneficiario(b, x, x.id === escolhido && x.disponivel)).join('');
    document.getElementById('dica-beneficiario').textContent = b.escopo === 'familia_mes'
      ? `Limite de ${reais(b.limite)} por competência compartilhado pelo grupo familiar · saldo ${reais(b.disponivel_familia)}.`
      : `Limite de ${reais(b.limite)} ${textoEscopo(b)}. Aparecem apenas os beneficiários elegíveis.`;
    document.getElementById('campo-nivel').hidden = b.codigo !== 'educacional';
    document.getElementById('anexos').innerHTML = [...b.documentos.map(d => ({ ...d, obrigatorio: true })), { tipo: 'outro', nome: 'Outros documentos', obrigatorio: false }].map(d => `
      <label class="anexo-campo" data-tipo="${d.tipo}">
        <input type="file" name="${d.tipo}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" ${d.tipo === 'outro' ? 'multiple' : ''}>
        <strong>📎 ${esc(d.nome)} ${d.obrigatorio ? '<em>*</em>' : '<small>(opcional)</small>'}</strong>
        <small data-nome>Clique ou arraste o arquivo aqui</small>
      </label>`).join('');
    document.getElementById('texto-declaracao').textContent = declaracaoTexto(b.codigo);
    habilitar('passo-beneficiario', true);
    aoEscolherBeneficiario();
  }

  async function aoEscolherBeneficiario() {
    const b = beneficio(selecionado('beneficio'));
    const id = selecionado('beneficiario');
    const ok = Boolean(b && id !== undefined);
    ['passo-despesa', 'passo-anexos', 'passo-confirmar'].forEach(x => habilitar(x, ok));
    saldoAtual = ok ? b.beneficiarios.find(x => String(x.id) === id) : null;
    await atualizarSaldo();
  }

  // Óculos: o saldo depende da data do documento (janela de 18 meses); os demais usam a competência.
  async function atualizarSaldo() {
    const b = beneficio(selecionado('beneficio'));
    const id = selecionado('beneficiario');
    if (b && b.codigo === 'oculos' && id !== undefined && campoData.value) {
      try {
        const s = await api(`/api/saldo?beneficio=oculos&beneficiario=${id}&data_documento=${campoData.value}`);
        saldoAtual = { ...saldoAtual, ...s };
      } catch { /* mantém o saldo da lista */ }
    }
    validarDespesa();
  }

  function validarDespesa() {
    const b = beneficio(selecionado('beneficio'));
    const alerta = document.getElementById('alerta-despesa');
    const dica = document.getElementById('dica-saldo');
    const msgs = [];
    if (saldoAtual) dica.textContent = `Saldo disponível: ${reais(saldoAtual.disponivel)} de ${reais(saldoAtual.limite)}`;
    const data = campoData.value;
    if (data) {
      if (data > hoje) msgs.push(['erro', 'A data do documento não pode ser futura.']);
      else if (data < minimo) {
        const dias = Math.round((Date.parse(hoje) - Date.parse(data)) / 86400e3);
        msgs.push(['erro', `Documento emitido há ${dias} dias. O prazo para solicitar reembolso é de até ${me.prazo_documento_dias} dias da emissão da nota fiscal ou do comprovante de pagamento.`]);
      }
      if (c.data_desligamento && data > c.data_desligamento) msgs.push(['erro', 'A data do documento é posterior à sua data de desligamento.']);
    }
    const v = centavos();
    if (v && saldoAtual && v > saldoAtual.disponivel) {
      msgs.push(['erro', saldoAtual.disponivel
        ? `O valor ultrapassa o saldo disponível (${reais(saldoAtual.disponivel)}). Ajuste o valor solicitado para até o saldo.`
        : saldoAtual.bloqueio || 'Limite atingido para este beneficiário no período. Não há saldo disponível.']);
    }
    alerta.innerHTML = msgs.map(([t, m]) => `<div class="alerta ${t}">⚠️ <span>${esc(m)}</span></div>`).join('');
    const resumo = document.getElementById('resumo-envio');
    if (resumo) resumo.innerHTML = b && v ? `${esc(b.curto)} · <strong>${reais(v)}</strong>` : '';
    return msgs.length === 0;
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'beneficio') aoEscolherBeneficio();
    else if (e.target.name === 'beneficiario') aoEscolherBeneficiario();
    else if (e.target.id === 'data-doc') atualizarSaldo();
    else if (e.target.type === 'file') {
      const campo = e.target.closest('.anexo-campo');
      const nomes = [...e.target.files].map(f => `${f.name} (${tamanhoArquivo(f.size)})`);
      const grande = [...e.target.files].find(f => f.size > 10 * 1024 * 1024);
      campo.classList.toggle('ok', nomes.length > 0 && !grande);
      campo.querySelector('[data-nome]').textContent = grande ? `⚠️ ${grande.name} tem mais de 10 MB` : (nomes.join(', ') || 'Clique ou arraste o arquivo aqui');
    }
  });
  campoData.addEventListener('input', validarDespesa);
  form.addEventListener('dragover', (e) => { const c2 = e.target.closest?.('.anexo-campo'); if (c2) c2.classList.add('arrastando'); });
  form.addEventListener('dragleave', (e) => { const c2 = e.target.closest?.('.anexo-campo'); if (c2) c2.classList.remove('arrastando'); });
  form.addEventListener('drop', (e) => { const c2 = e.target.closest?.('.anexo-campo'); if (c2) c2.classList.remove('arrastando'); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro-envio');
    const falhar = (m) => { erro.textContent = `⚠️ ${m}`; erro.hidden = false; };
    erro.hidden = true;
    const b = beneficio(selecionado('beneficio'));
    if (!b) return falhar('Selecione o benefício.');
    if (selecionado('beneficiario') === undefined) return falhar('Selecione o beneficiário da despesa.');
    if (!campoData.value) return falhar('Informe a data de emissão do documento.');
    if (!centavos()) return falhar('Informe o valor da despesa.');
    if (!validarDespesa()) return falhar('Corrija os dados da despesa indicados acima.');
    if (b.codigo === 'educacional' && !document.getElementById('nivel-ensino').value) return falhar('Informe o nível de ensino do dependente.');
    const faltando = b.documentos.filter(d => !form.querySelector(`input[name="${d.tipo}"]`).files.length);
    if (faltando.length) return falhar(`Anexe os documentos obrigatórios: ${faltando.map(d => d.nome).join(', ')}.`);
    if ([...form.querySelectorAll('input[type=file]')].some(i => [...i.files].some(f => f.size > 10 * 1024 * 1024))) return falhar('Cada documento pode ter no máximo 10 MB.');
    if (!document.getElementById('declaracao').checked) return falhar('Confirme a declaração para enviar.');

    const botao = document.getElementById('btn-enviar');
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    try {
      const r = await api('/api/solicitacoes', { method: 'POST', body: new FormData(form) });
      await carregar();
      renderLateral();
      conteudo.innerHTML = `
        <div class="cartao" style="max-width:640px;margin:2rem auto;text-align:center;padding:2.2rem">
          <div style="font-size:2.6rem">✅</div>
          <h1 class="titulo-pagina" style="margin:.6rem 0">Solicitação <em>enviada!</em></h1>
          <p>Protocolo <strong style="color:var(--marinho)">${esc(r.protocolo)}</strong>. Sua solicitação está <strong>em análise</strong> pelo RH.</p>
          <p class="q-dica">${estado.me.colaborador.email && estado.me.email_ativo ? `Você receberá a confirmação e as atualizações em ${esc(estado.me.colaborador.email)}.` : 'Acompanhe o status em “Minhas solicitações”.'}</p>
          <div class="linha-form" style="justify-content:center">
            <a class="btn btn-claro" href="#/minhas">Minhas solicitações</a>
            <a class="btn btn-laranja" href="#/nova" data-recarregar>Nova solicitação</a>
          </div>
        </div>`;
      window.scrollTo(0, 0);
    } catch (err) {
      falhar(err.message);
      botao.disabled = false;
      botao.textContent = 'Enviar solicitação';
    }
  });

  if (codigoInicial && beneficio(codigoInicial)) aoEscolherBeneficio(beneficiarioInicial);
  else if (me.beneficios.length === 1) { form.querySelector('input[name="beneficio"]').checked = true; aoEscolherBeneficio(); }
}

// ---------- Minhas solicitações ----------

function renderMinhas() {
  conteudo.innerHTML = `
    <div class="ind-cab" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem">
      <h1 class="titulo-pagina" style="margin:0">Minhas <em>solicitações</em></h1>
      <div style="margin-left:auto;display:flex;gap:.5rem;flex-wrap:wrap">
        <select class="campo" id="f-status" style="width:auto;padding:.45rem .7rem" aria-label="Status">
          <option value="">Todos os status</option><option value="analise">Em análise</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option>
        </select>
        <select class="campo" id="f-beneficio" style="width:auto;padding:.45rem .7rem" aria-label="Benefício">
          <option value="">Todos os benefícios</option>
          ${[...new Map(estado.solicitacoes.map(s => [s.beneficio, s.beneficio_nome])).entries()].map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cartao"><div class="lista-sol" id="lista-minhas"></div></div>`;
  const desenhar = () => {
    const st = document.getElementById('f-status').value;
    const be = document.getElementById('f-beneficio').value;
    const lista = estado.solicitacoes.filter(s => (!st || s.status === st) && (!be || s.beneficio === be));
    document.getElementById('lista-minhas').innerHTML = lista.map(itemSolicitacao).join('')
      || '<p class="vazio-bloco"><span>🧾</span>Nenhuma solicitação encontrada.</p>';
  };
  document.getElementById('f-status').addEventListener('change', desenhar);
  document.getElementById('f-beneficio').addEventListener('change', desenhar);
  desenhar();
}

function abrirSolicitacao(id) {
  const s = estado.solicitacoes.find(x => x.id === id);
  if (!s) return;
  document.getElementById('sol-protocolo').textContent = `PROTOCOLO ${s.protocolo}`;
  document.getElementById('sol-titulo').innerHTML = `${esc(s.beneficio_nome)} ${etiquetaStatus(s.status)}`;
  document.getElementById('sol-corpo').innerHTML = `
    ${s.status === 'reprovado' ? `<div class="alerta erro" style="margin:0">↩️ <span><strong>Reprovada pelo RH.</strong> ${esc(s.observacao_rh || '')}</span></div>` : ''}
    ${s.status === 'aprovado' ? `<div class="alerta ok" style="margin:0">✅ <span>Aprovada: ${reais(s.valor_aprovado)}${s.valor_aprovado < s.valor_solicitado ? ` (de ${reais(s.valor_solicitado)} solicitados)` : ''}. O valor será pago na folha da competência ${competenciaBR(s.competencia)}.${s.observacao_rh ? ` Observação do RH: ${esc(s.observacao_rh)}` : ''}</span></div>` : ''}
    <div class="det-grade">
      <div class="det-bloco">
        <h4>Dados da solicitação</h4>
        <dl class="dados-cad">
          <div><dt>Beneficiário</dt><dd>${esc(s.beneficiario_nome)}</dd></div>
          <div><dt>Vínculo</dt><dd>${esc(s.beneficiario_rotulo)}</dd></div>
          <div><dt>Competência</dt><dd>${competenciaBR(s.competencia)}</dd></div>
          <div><dt>Data do documento</dt><dd>${dataBR(s.data_documento)}</dd></div>
          <div><dt>Valor solicitado</dt><dd>${reais(s.valor_solicitado)}</dd></div>
          <div><dt>Valor aprovado</dt><dd>${s.valor_aprovado != null ? reais(s.valor_aprovado) : '–'}</dd></div>
          ${s.detalhes.nivel_ensino ? `<div><dt>Nível de ensino</dt><dd>${esc(s.detalhes.nivel_ensino)}</dd></div>` : ''}
          ${s.detalhes.descricao ? `<div style="grid-column:1/-1"><dt>Descrição</dt><dd>${esc(s.detalhes.descricao)}</dd></div>` : ''}
        </dl>
        <h4 style="margin-top:.6rem">Documentos enviados</h4>
        <div class="anexos-lista">${s.anexos.map(a => `<a href="/api/anexos/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.tipo_nome)} · ${esc(a.nome_original)}<small>${tamanhoArquivo(a.tamanho)}</small></a>`).join('')}</div>
      </div>
      <div class="det-bloco">
        <h4>Andamento</h4>
        <ol class="linha-tempo">${s.eventos.map(ev => `<li><strong>${esc(ev.evento)}</strong><small>${dataHoraBR(ev.em)}</small>${ev.detalhe ? `<p>${esc(ev.detalhe)}</p>` : ''}</li>`).join('')}</ol>
      </div>
    </div>`;
  document.getElementById('modal-sol').showModal();
}

// ---------- Rotas ----------

/** Navega para a rota; se já estiver nela, redesenha a página (ex.: clicar de novo em "Nova solicitação"). */
function irPara(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

function rotear() {
  if (!estado.me) return;
  renderLateral();
  const h = location.hash;
  let m;
  let titulo = 'Meu painel';
  if ((m = h.match(/^#\/beneficio\/(\w+)/))) { renderBeneficio(m[1]); titulo = beneficio(m[1])?.nome || titulo; }
  else if ((m = h.match(/^#\/nova(?:\/(\w+))?(?:\/(\d+))?/))) { renderNova(m[1], m[2]); titulo = 'Nova solicitação'; }
  else if (h.startsWith('#/minhas')) { renderMinhas(); titulo = 'Minhas solicitações'; }
  else if (h.startsWith('#/recadastro')) { renderRecadastro().catch(err => toast(err.message, 'erro')); titulo = 'Recadastramento anual'; }
  else renderPainel();
  document.getElementById('titulo-barra').textContent = titulo;
  document.getElementById('lateral').classList.remove('aberta');
  conteudo.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const rota = e.target.closest('[data-rota]');
  if (rota) { irPara(`#/${rota.dataset.rota}`); return; }
  const b = e.target.closest('[data-beneficio]');
  if (b) { irPara(`#/beneficio/${b.dataset.beneficio}`); return; }
  const sol = e.target.closest('[data-sol]');
  if (sol) { abrirSolicitacao(Number(sol.dataset.sol)); return; }
  if (e.target.closest('[data-voltar]')) { location.hash = '#/painel'; return; }
  if (e.target.closest('[data-recarregar]') && location.hash === '#/nova') { rotear(); return; }
  if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close();
});
document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('lateral').classList.toggle('aberta'));
document.getElementById('sair').addEventListener('click', async () => {
  await api('/api/sair', { method: 'POST' });
  location.href = 'index.html';
});
window.addEventListener('hashchange', async () => {
  // Ao voltar ao painel ou às listas, recarrega os saldos e o status mais recentes.
  if (!location.hash.startsWith('#/nova') && !location.hash.startsWith('#/beneficio')) await carregar();
  rotear();
});

carregar().then(ok => { if (ok) rotear(); }).catch(err => {
  conteudo.innerHTML = `<p class="carregando">Não foi possível carregar o portal: ${esc(err.message)}</p>`;
});
