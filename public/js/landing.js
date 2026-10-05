// Home pública: acesso por CPF + matrícula e resumo dos benefícios e prazos.
const form = document.getElementById('acesso');
const campoCpf = document.getElementById('cpf');
const campoMatricula = document.getElementById('matricula');
const msg = document.getElementById('acesso-msg');
mascaraCpf(campoCpf);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'acesso-msg';
  msg.textContent = '';
  const cpf = campoCpf.value.replace(/\D/g, '');
  const matricula = campoMatricula.value.trim();
  if (cpf.length !== 11 || !matricula) {
    msg.textContent = cpf.length !== 11 ? 'Digite os 11 números do seu CPF.' : 'Informe sua matrícula.';
    msg.classList.add('erro');
    return;
  }
  const botao = form.querySelector('button');
  botao.disabled = true;
  try {
    const r = await api('/api/entrar', { method: 'POST', body: { cpf, matricula } });
    msg.textContent = `Olá, ${r.nome.split(' ')[0]}! Abrindo o portal…`;
    msg.classList.add('ok');
    setTimeout(() => { location.href = 'portal.html'; }, 600);
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('erro');
    form.classList.remove('tremer');
    void form.offsetWidth;
    form.classList.add('tremer');
    botao.disabled = false;
  }
});

(async function carregarInfo() {
  try {
    const r = await api('/api/publico/info');
    const p = r.periodo;
    const dois = (n) => String(n).padStart(2, '0');
    document.querySelectorAll('[data-dia-inicio]').forEach(el => { el.textContent = dois(p.dia_inicio); });
    document.querySelectorAll('[data-dia-fim]').forEach(el => { el.textContent = dois(p.dia_fim); });
    document.querySelectorAll('[data-prazo]').forEach(el => { el.textContent = r.prazo_documento_dias; });
    document.getElementById('acesso-periodo').textContent = p.aberto
      ? `Solicitações abertas até ${dataBR(p.encerra_em)}`
      : `Solicitações fechadas · próxima abertura em ${dataBR(p.proxima_abertura)}`;
    document.getElementById('grade-beneficios').innerHTML = r.beneficios.map(b => {
      const valor = b.escopo === 'dependente_mes'
        ? `${reais(b.limite_nao_sucedido)} a ${reais(b.limite_sucedido)}<small>por dependente, por mês (conforme o perfil)</small>`
        : b.escopo === 'familia_mes'
          ? `até ${reais(b.limite)}<small>por mês, para todo o grupo familiar</small>`
          : `até ${reais(b.limite)}<small>por beneficiário, a cada ${b.periodo_meses} meses</small>`;
      return `
        <article class="beneficio-card">
          <span class="pilar-ic">${b.icone}</span>
          <h3>${esc(b.nome)}</h3>
          <div class="valor">${valor}</div>
          <p>${esc(b.elegiveis)}</p>
          <p class="docs">📎 ${esc(b.documentos.join(' + '))}</p>
        </article>`;
    }).join('');
  } catch { /* mantém os textos padrão */ }
})();
