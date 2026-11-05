// Colaboradores e acessos: usado na Área do RH e na Administração.
// Incluir e editar cadastro e dependentes, bloquear/liberar e excluir/restaurar o acesso.
// Nenhuma ação apaga solicitações: o histórico continua na análise, na folha e nos relatórios.
const SITUACOES = {
  liberado: ['ok', 'Liberado'],
  bloqueado: ['nao', 'Bloqueado'],
  fora_base: ['neutra', 'Fora da base'],
  excluido: ['neutra', 'Acesso excluído'],
};
const NOMES_BENEF = { medicamento: 'Medicamento', educacional: 'Educacional', creche: 'Creche/Babá', oculos: 'Óculos', material: 'Material Escolar/Uniforme' };
const OPCOES_PARENTESCO = [['conjuge', 'Cônjuge/Companheiro(a)'], ['filho', 'Filho(a)'], ['enteado', 'Enteado(a)'], ['neto', 'Neto(a) com tutela'], ['tutelado', 'Tutelado(a)'], ['pai', 'Pai'], ['mae', 'Mãe']];

const Colaboradores = (() => {
  let lista = [];
  let editando = null; // CPF do colaborador aberto no formulário
  let pendentes = []; // dependentes de um colaborador novo, salvos junto com ele
  let seq = 0;
  let opcoes = {};
  let unidades = []; // lista oficial de filiais (regras.js)
  const $ = (id) => document.getElementById(id);

  function montar(container, { aoVerHistorico, admin = false } = {}) {
    opcoes = { aoVerHistorico, admin };
    container.innerHTML = `
      <div class="ind-cab">
        <h1 class="titulo-pagina">Colaboradores e <em>acessos</em></h1>
        <button class="btn btn-laranja" id="colab-novo">＋ Incluir colaborador</button>
      </div>
      <div class="cartao">
        <div class="cab-tabela">
          <h3>👥 Colaboradores <small id="qtd-colab"></small></h3>
          <div class="filtros">
            <select class="campo" id="filtro-acesso" aria-label="Situação do acesso">
              <option value="ativos">Na base (sem excluídos)</option><option value="liberado">Liberados</option><option value="bloqueado">Bloqueados</option>
              <option value="fora_base">Fora da base</option><option value="excluido">Acesso excluído</option><option value="">Todos</option>
            </select>
            <input class="campo" id="busca-colab" placeholder="Nome, CPF, matrícula, unidade…" aria-label="Buscar">
          </div>
        </div>
        <p class="q-dica" style="margin-top:0"><strong>Bloquear</strong> tira o acesso na hora e vale até alguém liberar, mesmo depois de novas cargas da base.
          <strong>Excluir acesso</strong> tira o colaborador da lista e do portal (ex.: desligado); ele volta se o CPF vier numa nova carga da base ou se for restaurado.
          Em nenhum caso as solicitações são apagadas: o histórico continua na análise, na folha e nos relatórios.</p>
        <div class="tabela-wrap"><table class="tabela" id="tabela-colab"></table></div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="modal modal-colab" id="modal-colab">
        <header><div><small id="colab-modal-sobre">CADASTRO</small><h3 id="colab-modal-titulo">Incluir colaborador</h3></div>
          <button type="button" class="btn btn-claro btn-sm" data-fechar aria-label="Fechar">✕</button></header>
        <div class="det-corpo">
          <form id="form-colab" class="grade-colab">
            <label class="rotulo">CPF<input class="campo" name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" required></label>
            <label class="rotulo">Matrícula<input class="campo" name="matricula" maxlength="30" required></label>
            <label class="rotulo largo">Nome completo<input class="campo" name="nome" maxlength="150" required></label>
            <label class="rotulo">E-mail <small>(opcional)</small><input class="campo" type="email" name="email" maxlength="150"></label>
            <label class="rotulo">Filial / unidade<select class="campo" name="unidade" required><option value="">Selecione…</option></select></label>
            <label class="rotulo">Data de admissão<input class="campo" type="date" name="data_admissao"></label>
            <label class="rotulo">Sucedido<select class="campo" name="sucedido">
              <option value="">Pela data de admissão (até 2011)</option><option value="S">Sim</option><option value="N">Não</option></select></label>
            <label class="rotulo">Data de desligamento <small>(opcional)</small><input class="campo" type="date" name="data_desligamento"></label>
            <div class="largo acoes-form" id="colab-acoes-editar"><button class="btn btn-laranja" type="submit" id="colab-salvar">Salvar alterações</button></div>
          </form>
          <section id="colab-deps">
            <h4 class="titulo-bloco">👨‍👩‍👧 Dependentes</h4>
            <div class="tabela-wrap"><table class="tabela" id="tabela-deps"></table></div>
            <form id="form-dep" class="grade-colab grade-dep">
              <input type="hidden" name="id">
              <label class="rotulo largo-2">Nome do dependente<input class="campo" name="nome" maxlength="150" required></label>
              <label class="rotulo">Parentesco<select class="campo" name="parentesco" required>
                <option value="">Selecione…</option>${OPCOES_PARENTESCO.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
              <label class="rotulo">Nascimento<input class="campo" type="date" name="data_nascimento"></label>
              <label class="rotulo">CPF <small>(opcional)</small><input class="campo" name="cpf" inputmode="numeric" maxlength="14"></label>
              <div class="acoes-form"><button class="btn btn-claro" type="button" id="dep-cancelar" hidden>Cancelar</button>
                <button class="btn btn-laranja" type="submit" id="dep-salvar">＋ Incluir dependente</button></div>
            </form>
            <p class="q-dica" id="deps-dica"></p>
          </section>
          <section id="colab-exc" hidden>
            <h4 class="titulo-bloco">⭐ Exceções de elegibilidade</h4>
            <div class="tabela-wrap"><table class="tabela" id="tabela-exc"></table></div>
            ${admin ? `<form id="form-exc" class="grade-colab grade-exc">
              <label class="rotulo">Beneficiário<select class="campo" name="dependente_id"></select></label>
              <label class="rotulo">Benefício<select class="campo" name="beneficio" required><option value="">Selecione…</option>
                ${Object.entries(NOMES_BENEF).map(([k, v]) => `<option value="${k}">${ICONES[k]} ${v}</option>`).join('')}</select></label>
              <label class="rotulo">Exceção<select class="campo" name="tipo"><option value="liberar">Liberar (mesmo fora da regra)</option><option value="bloquear">Bloquear</option></select></label>
              <label class="rotulo">Válida até <small>(opcional)</small><input class="campo" type="date" name="valida_ate"></label>
              <label class="rotulo largo">Motivo<input class="campo" name="motivo" maxlength="300" required placeholder="Ex.: acordo coletivo 2026/2027"></label>
              <div class="largo acoes-form"><button class="btn btn-laranja" type="submit">Salvar exceção</button></div>
            </form>` : ''}
            <p class="q-dica">${admin
              ? 'A exceção vale acima da regra do benefício e da base mensal (novas cargas da planilha não a apagam). O limite de valor e os prazos continuam os do benefício. Tudo fica na auditoria.'
              : 'Exceções são cadastradas pelo administrador do portal.'}</p>
          </section>
        </div>
        <footer id="colab-rodape-novo"><span class="q-dica">Os dependentes da lista são salvos junto com o colaborador.</span>
          <button class="btn btn-laranja" type="submit" form="form-colab">Incluir colaborador</button></footer>
      </dialog>
      <dialog class="modal qr-modal" id="modal-acesso">
        <form id="form-acesso">
          <header><div><small>ACESSO AO PORTAL</small><h3 id="acesso-titulo"></h3></div>
            <button type="button" class="btn btn-claro btn-sm" data-fechar aria-label="Fechar">✕</button></header>
          <div class="det-corpo">
            <p id="acesso-texto" style="margin:0"></p>
            <div class="alerta ok" style="margin:0">🗂️ <span>As solicitações deste colaborador <strong>não serão apagadas</strong>: continuam no histórico, na folha e nos relatórios.</span></div>
            <label class="rotulo">Motivo <small>(opcional, fica na auditoria)</small><input class="campo" name="motivo" maxlength="300" placeholder="Ex.: desligamento em 30/09"></label>
          </div>
          <footer><span></span><button class="btn btn-perigo" type="submit" id="acesso-confirmar">Confirmar</button></footer>
        </form>
      </dialog>`);

    mascaraCpf($('form-colab').cpf);
    mascaraCpf($('form-dep').cpf);
    $('busca-colab').addEventListener('input', render);
    $('filtro-acesso').addEventListener('change', render);
    $('colab-novo').addEventListener('click', () => abrir(null));
    $('tabela-colab').addEventListener('click', aoClicarTabela);
    $('form-colab').addEventListener('submit', salvarColaborador);
    $('form-dep').addEventListener('submit', salvarDependente);
    $('dep-cancelar').addEventListener('click', limparDependente);
    $('tabela-deps').addEventListener('click', aoClicarDependente);
    $('form-acesso').addEventListener('submit', confirmarAcesso);
    $('tabela-exc').addEventListener('click', removerExcecao);
    if (admin) $('form-exc').addEventListener('submit', salvarExcecao);
  }

  async function carregar() {
    if (!unidades.length) unidades = await api('/api/admin/unidades');
    lista = await api('/api/admin/colaboradores');
    render();
  }

  function render() {
    const termo = semAcento($('busca-colab').value);
    const situacao = $('filtro-acesso').value;
    const digitos = termo.replace(/[.\-/\s]/g, '');
    const filtrada = lista.filter(c => (situacao === '' || (situacao === 'ativos' ? c.situacao !== 'excluido' : c.situacao === situacao)) && (!termo
      || semAcento([c.nome, c.matricula, c.unidade, c.email].join(' ')).includes(termo)
      || (digitos && /^\d+$/.test(digitos) && c.cpf.includes(digitos))));
    const conta = (s) => lista.filter(c => c.situacao === s).length;
    $('qtd-colab').textContent = `· ${fmt(conta('liberado'))} com acesso · ${fmt(conta('bloqueado'))} bloqueado(s) · ${fmt(conta('excluido'))} excluído(s)`;
    $('tabela-colab').innerHTML = `
      <tr><th>Colaborador</th><th>Perfil</th><th>Dep.</th><th>Elegibilidade</th><th>Solicitações</th><th>Situação</th><th>Ações</th></tr>
      ${filtrada.slice(0, 500).map(c => {
        const [classe, rotulo] = SITUACOES[c.situacao];
        const temAcesso = c.situacao === 'liberado';
        return `
        <tr class="${temAcesso ? '' : 'inativo-suave'}">
          <td><strong>${esc(c.nome)}</strong>${c.origem === 'manual' ? ' <span class="etiqueta neutra" title="Incluído manualmente pelo RH">manual</span>' : ''}
            <br><small class="q-dica">${formatarCpf(c.cpf)} · Mat. ${esc(c.matricula)}${c.unidade ? ` · ${esc(c.unidade)}` : ''}</small>
            <br><small class="q-dica">Último acesso: ${c.ultimo_acesso ? dataHoraBR(c.ultimo_acesso) : 'nunca'}</small>
            ${c.data_desligamento ? `<br><small class="q-dica">Desligamento: ${dataBR(c.data_desligamento)}</small>` : ''}</td>
          <td>${c.sucedido ? 'Sucedido' : 'Não sucedido'}<br><small class="q-dica">Admissão ${c.data_admissao ? dataBR(c.data_admissao) : '–'}</small></td>
          <td title="${esc(c.dependentes.map(d => `${d.nome} (${d.rotulo})`).join('\n'))}">${fmt(c.dependentes.length)}</td>
          <td>${Object.entries(c.beneficios).filter(([, n]) => n.length).map(([k, n]) => `<span class="etiqueta neutra" title="${esc(n.join('\n'))}">${ICONES[k]} ${n.length}</span>`).join(' ') || '<span class="q-dica">nenhum</span>'}
            ${(c.fora_da_regra || []).length ? `<br><span class="etiqueta nao" title="${esc(c.fora_da_regra.map(f => `${NOMES_BENEF[f.beneficio]} · ${f.nome} · ${f.origem === 'base' ? 'coluna S da base' : 'exceção'}${f.motivo_regra ? ` · pela regra: ${f.motivo_regra}` : ''}`).join('\n'))}">⚠️ fora da regra</span>` : ''}
            ${c.excecoes.some(e => e.vigente) ? `<br><span class="etiqueta exc" title="${esc(c.excecoes.filter(e => e.vigente).map(e => `${e.tipo === 'liberar' ? 'Liberado' : 'Bloqueado'}: ${NOMES_BENEF[e.beneficio]} · ${e.beneficiario} · ${e.motivo}`).join('\n'))}">⭐ exceção</span>` : ''}</td>
          <td>${c.solicitacoes ? (opcoes.aoVerHistorico ? `<button class="link-btn" data-historico="${c.cpf}">${fmt(c.solicitacoes)} · ver</button>` : fmt(c.solicitacoes)) : '<span class="q-dica">0</span>'}</td>
          <td><span class="etiqueta ${classe}">${rotulo}</span>${c.motivo_bloqueio && !temAcesso ? `<br><small class="q-dica">${esc(c.motivo_bloqueio)}</small>` : ''}${c.excluido_em ? `<br><small class="q-dica">em ${dataBR(c.excluido_em.slice(0, 10))}</small>` : ''}</td>
          <td class="acoes-colab">
            <button class="btn btn-claro btn-sm" data-editar="${c.cpf}">Editar</button>
            ${c.situacao === 'excluido' ? `<button class="btn btn-laranja btn-sm" data-acao="restaurar" data-cpf="${c.cpf}">Restaurar</button>` : `
              ${c.bloqueado ? `<button class="btn btn-laranja btn-sm" data-acao="liberar" data-cpf="${c.cpf}">Liberar</button>`
                : c.situacao === 'fora_base' ? `<button class="btn btn-laranja btn-sm" data-acao="liberar" data-cpf="${c.cpf}" title="Libera o acesso mesmo fora da última carga da base">Liberar</button>`
                : `<button class="btn btn-perigo btn-sm" data-acao="bloquear" data-cpf="${c.cpf}">Bloquear</button>`}
              <button class="btn btn-perigo btn-sm" data-acao="excluir" data-cpf="${c.cpf}">Excluir acesso</button>`}
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7">Nenhum colaborador encontrado.</td></tr>'}
      ${filtrada.length > 500 ? '<tr><td colspan="7" class="q-dica">Mostrando os 500 primeiros. Use a busca para encontrar outros.</td></tr>' : ''}`;
  }

  const porCpf = (cpf) => lista.find(c => c.cpf === cpf);

  async function aoClicarTabela(e) {
    const ed = e.target.closest('[data-editar]');
    if (ed) return abrir(ed.dataset.editar);
    const h = e.target.closest('[data-historico]');
    if (h) return opcoes.aoVerHistorico(h.dataset.historico);
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const c = porCpf(b.dataset.cpf);
    const acao = b.dataset.acao;
    if (acao === 'liberar' || acao === 'restaurar') {
      try {
        await api(`/api/admin/colaboradores/${c.cpf}/${acao}`, { method: 'POST', body: {} });
        toast(acao === 'liberar' ? `Acesso de ${c.nome.split(' ')[0]} liberado.` : `Acesso de ${c.nome.split(' ')[0]} restaurado.`);
        carregar();
      } catch (err) { toast(err.message, 'erro'); }
      return;
    }
    const f = $('form-acesso');
    f.reset();
    f.dataset.cpf = c.cpf;
    f.dataset.acao = acao;
    $('acesso-titulo').textContent = acao === 'bloquear' ? `Bloquear ${c.nome}` : `Excluir o acesso de ${c.nome}`;
    $('acesso-texto').innerHTML = acao === 'bloquear'
      ? 'A pessoa é desconectada na hora e não consegue entrar até ser liberada. O bloqueio continua valendo mesmo que o CPF venha nas próximas cargas da base.'
      : 'O colaborador sai da lista e perde o acesso ao portal (ex.: desligamento). Você pode restaurar depois em “Acesso excluído”. Se o CPF vier numa nova carga da base, o acesso volta automaticamente.';
    $('acesso-confirmar').textContent = acao === 'bloquear' ? 'Bloquear acesso' : 'Excluir acesso';
    $('modal-acesso').showModal();
  }

  async function confirmarAcesso(e) {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/admin/colaboradores/${f.dataset.cpf}/${f.dataset.acao}`, { method: 'POST', body: { motivo: f.motivo.value } });
      $('modal-acesso').close();
      toast(f.dataset.acao === 'bloquear' ? 'Acesso bloqueado. O histórico foi mantido.' : 'Acesso excluído. O histórico de solicitações foi mantido.');
      carregar();
    } catch (err) { toast(err.message, 'erro'); }
  }

  function abrir(cpf) {
    editando = cpf;
    const f = $('form-colab');
    f.reset();
    const c = cpf && porCpf(cpf);
    $('colab-modal-titulo').textContent = c ? c.nome : 'Incluir colaborador';
    $('colab-modal-sobre').textContent = c ? `CPF ${formatarCpf(c.cpf)}` : 'NOVO CADASTRO';
    f.cpf.readOnly = Boolean(c);
    // Lista suspensa de filiais; uma unidade da base fora da lista aparece só para este cadastro, até ser trocada.
    const atual = c && c.unidade && !unidades.includes(c.unidade) ? c.unidade : null;
    f.unidade.innerHTML = '<option value="">Selecione…</option>'
      + (atual ? `<option value="${esc(atual)}">${esc(atual)} (da base, fora da lista)</option>` : '')
      + unidades.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    f.unidade.value = c ? (c.unidade || '') : '';
    if (c) {
      f.cpf.value = formatarCpf(c.cpf);
      for (const k of ['matricula', 'nome', 'email', 'data_admissao', 'data_desligamento']) f[k].value = c[k] || '';
      f.sucedido.value = c.sucedido_base === 1 ? 'S' : c.sucedido_base === 0 ? 'N' : '';
    }
    $('colab-acoes-editar').hidden = !c;
    $('colab-rodape-novo').hidden = Boolean(c);
    if (!c) pendentes = [];
    renderDependentes();
    renderExcecoes();
    if (!$('modal-colab').open) $('modal-colab').showModal();
    (c ? f.matricula : f.cpf).focus();
  }

  const rotuloParentesco = (v) => (OPCOES_PARENTESCO.find(([k]) => k === v) || [, v])[1];
  /** Dependentes exibidos: os já cadastrados (edição) ou a lista provisória (colaborador novo). */
  const dependentesAtuais = () => (editando ? porCpf(editando).dependentes : pendentes);

  function renderDependentes() {
    limparDependente();
    $('deps-dica').textContent = editando
      ? 'Remover um dependente tira ele dos benefícios a partir de agora; as solicitações já feitas para ele continuam no histórico.'
      : 'Inclua os dependentes agora (opcional). Eles só são gravados quando você clicar em “Incluir colaborador”.';
    const c = editando && porCpf(editando);
    const fora = c ? c.fora_da_regra || [] : [];
    $('tabela-deps').innerHTML = `
      ${fora.length ? `<tr><td colspan="6"><div class="alerta aviso" style="margin:0">⚠️ <span><strong>Liberado fora da regra:</strong> ${fora.map(f => `${esc(f.nome.split(' ')[0])} — ${esc(NOMES_BENEF[f.beneficio])} ${f.origem === 'base' ? `(coluna ${f.beneficio.toUpperCase()} = S na base)` : '(exceção do administrador)'}${f.motivo_regra ? `; pela regra: ${esc(f.motivo_regra.toLowerCase())}` : ''}`).join(' · ')}</span></div></td></tr>` : ''}
      <tr><th>Nome</th><th>Parentesco</th><th>Nascimento</th><th>CPF</th><th>Marcações da base</th><th></th></tr>
      ${dependentesAtuais().map(d => `<tr><td>${esc(d.nome)}</td><td>${esc(d.rotulo)}</td>
        <td>${d.data_nascimento ? `${dataBR(d.data_nascimento)}${d.idade ? `<br><small class="q-dica">${esc(d.idade)}</small>` : ''}` : '–'}</td><td>${d.cpf ? formatarCpf(d.cpf) : '–'}</td>
        <td>${Object.entries(d.marcacoes || {}).map(([k, v]) => `<span class="etiqueta ${v === 'S' ? 'exc' : 'nao'}" title="${v === 'S' ? 'S na planilha: libera mesmo fora da regra' : 'N na planilha: bloqueia'}">${k.toUpperCase()}: ${v}</span>`).join(' ') || '<span class="q-dica">–</span>'}</td>
        <td class="acoes-colab"><button class="btn btn-claro btn-sm" data-dep-editar="${d.id}">Editar</button><button class="btn btn-perigo btn-sm" data-dep-remover="${d.id}">Remover</button></td></tr>`).join('')
        || '<tr><td colspan="6" class="q-dica">Nenhum dependente cadastrado.</td></tr>'}`;
  }

  function renderExcecoes() {
    const c = editando && porCpf(editando);
    $('colab-exc').hidden = !c || (!opcoes.admin && !c.excecoes.length);
    if (!c) return;
    $('tabela-exc').innerHTML = `
      <tr><th>Beneficiário</th><th>Benefício</th><th>Exceção</th><th>Motivo</th><th>Validade</th><th>Cadastrada</th>${opcoes.admin ? '<th></th>' : ''}</tr>
      ${c.excecoes.map(e => `<tr class="${e.vigente ? '' : 'inativo'}">
        <td>${esc(e.beneficiario)}</td><td>${ICONES[e.beneficio]} ${esc(NOMES_BENEF[e.beneficio])}</td>
        <td><span class="etiqueta ${e.tipo === 'liberar' ? 'ok' : 'nao'}">${e.tipo === 'liberar' ? 'Liberado' : 'Bloqueado'}</span></td>
        <td>${esc(e.motivo)}</td><td>${e.valida_ate ? `até ${dataBR(e.valida_ate)}${e.vigente ? '' : ' (vencida)'}` : 'sem prazo'}</td>
        <td><small class="q-dica">${dataHoraBR(e.criado_em)}<br>${esc(e.criado_por || '')}</small></td>
        ${opcoes.admin ? `<td><button class="btn btn-perigo btn-sm" data-exc-remover="${e.id}">Remover</button></td>` : ''}</tr>`).join('')
        || `<tr><td colspan="${opcoes.admin ? 7 : 6}" class="q-dica">Nenhuma exceção: este colaborador segue as regras dos benefícios.</td></tr>`}`;
    if (opcoes.admin) {
      const f = $('form-exc');
      f.reset();
      f.dependente_id.innerHTML = `<option value="">${esc(c.nome)} (titular)</option>`
        + c.dependentes.map(d => `<option value="${d.id}">${esc(d.nome)} (${esc(d.rotulo)})</option>`).join('');
    }
  }

  async function salvarExcecao(e) {
    e.preventDefault();
    const f = e.target;
    const corpo = Object.fromEntries(['dependente_id', 'beneficio', 'tipo', 'valida_ate', 'motivo'].map(k => [k, f[k].value]));
    try {
      await api(`/api/admin/colaboradores/${editando}/excecoes`, { method: 'POST', body: corpo });
      toast(corpo.tipo === 'liberar' ? 'Exceção salva: benefício liberado.' : 'Exceção salva: benefício bloqueado.');
      await carregar();
      renderExcecoes();
    } catch (err) { toast(err.message, 'erro'); }
  }

  async function removerExcecao(e) {
    const b = e.target.closest('[data-exc-remover]');
    if (!b) return;
    if (!confirm('Remover esta exceção? O beneficiário volta a seguir a regra do benefício.')) return;
    try {
      await api(`/api/admin/excecoes/${b.dataset.excRemover}/remover`, { method: 'POST', body: {} });
      toast('Exceção removida.');
      await carregar();
      renderExcecoes();
    } catch (err) { toast(err.message, 'erro'); }
  }

  function limparDependente() {
    const f = $('form-dep');
    f.reset();
    f.id.value = '';
    $('dep-salvar').textContent = '＋ Incluir dependente';
    $('dep-cancelar').hidden = true;
  }

  async function aoClicarDependente(e) {
    const c = editando && porCpf(editando);
    const ed = e.target.closest('[data-dep-editar]');
    if (ed) {
      const d = dependentesAtuais().find(x => String(x.id) === ed.dataset.depEditar);
      const f = $('form-dep');
      f.id.value = d.id;
      f.nome.value = d.nome;
      f.parentesco.value = d.parentesco;
      f.data_nascimento.value = d.data_nascimento || '';
      f.cpf.value = d.cpf ? formatarCpf(d.cpf) : '';
      $('dep-salvar').textContent = 'Salvar dependente';
      $('dep-cancelar').hidden = false;
      f.nome.focus();
      return;
    }
    const rm = e.target.closest('[data-dep-remover]');
    if (!rm) return;
    if (!c) { // colaborador novo: só tira da lista provisória
      pendentes = pendentes.filter(x => String(x.id) !== rm.dataset.depRemover);
      renderDependentes();
      return;
    }
    const d = c.dependentes.find(x => String(x.id) === rm.dataset.depRemover);
    if (!confirm(`Remover ${d.nome} dos dependentes de ${c.nome}? As solicitações já feitas para ${d.nome.split(' ')[0]} continuam no histórico.`)) return;
    try {
      await api(`/api/admin/dependentes/${d.id}/remover`, { method: 'POST', body: {} });
      toast('Dependente removido. O histórico foi mantido.');
      await carregar();
      renderDependentes();
    } catch (err) { toast(err.message, 'erro'); }
  }

  async function salvarColaborador(e) {
    e.preventDefault();
    const f = e.target;
    const corpo = Object.fromEntries(['cpf', 'matricula', 'nome', 'email', 'unidade', 'data_admissao', 'sucedido', 'data_desligamento'].map(k => [k, f[k].value]));
    try {
      if (editando) {
        await api(`/api/admin/colaboradores/${editando}`, { method: 'PUT', body: corpo });
        toast('Cadastro atualizado.');
        await carregar();
        abrir(editando);
      } else {
        corpo.dependentes = pendentes.map(({ nome, parentesco, data_nascimento, cpf }) => ({ nome, parentesco, data_nascimento, cpf }));
        await api('/api/admin/colaboradores', { method: 'POST', body: corpo });
        toast(pendentes.length ? `Colaborador incluído com ${pendentes.length} dependente(s).` : 'Colaborador incluído.');
        pendentes = [];
        await carregar();
        abrir(corpo.cpf.replace(/\D/g, ''));
      }
    } catch (err) { toast(err.message, 'erro'); }
  }

  async function salvarDependente(e) {
    e.preventDefault();
    const f = e.target;
    const corpo = { nome: f.nome.value.trim(), parentesco: f.parentesco.value, data_nascimento: f.data_nascimento.value, cpf: f.cpf.value.replace(/\D/g, '') };
    if (!editando) { // colaborador novo: guarda na lista provisória
      if (corpo.cpf && corpo.cpf.length !== 11) return toast('CPF do dependente inválido.', 'erro');
      const item = { ...corpo, rotulo: rotuloParentesco(corpo.parentesco) };
      if (f.id.value) pendentes = pendentes.map(x => (String(x.id) === f.id.value ? { ...item, id: x.id } : x));
      else pendentes.push({ ...item, id: `n${++seq}` });
      renderDependentes();
      f.nome.focus();
      return;
    }
    try {
      if (f.id.value) await api(`/api/admin/dependentes/${f.id.value}`, { method: 'PUT', body: corpo });
      else await api(`/api/admin/colaboradores/${editando}/dependentes`, { method: 'POST', body: corpo });
      toast(f.id.value ? 'Dependente atualizado.' : 'Dependente incluído.');
      await carregar();
      renderDependentes();
    } catch (err) { toast(err.message, 'erro'); }
  }

  return { montar, carregar };
})();
