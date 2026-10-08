// Home pública: acesso por CPF, calendário de envio do mês e resumo dos benefícios.
const form = document.getElementById('acesso');
const campoCpf = document.getElementById('cpf');
const msg = document.getElementById('acesso-msg');
mascaraCpf(campoCpf);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'acesso-msg';
  msg.textContent = '';
  const cpf = campoCpf.value.replace(/\D/g, '');
  if (cpf.length !== 11) {
    msg.textContent = 'Digite os 11 números do seu CPF.';
    msg.classList.add('erro');
    return;
  }
  const botao = form.querySelector('button');
  botao.disabled = true;
  try {
    const r = await api('/api/entrar', { method: 'POST', body: { cpf } });
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

const dois = (n) => String(n).padStart(2, '0');

/** Calendário do mês atual com a janela de envio destacada e o dia de hoje marcado. */
function desenharCalendario(hoje, p) {
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const primeiroDiaSemana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  // Com abertura excepcional, a janela vai até a data informada pelo RH (se for neste mês).
  let fim = p.dia_fim;
  if (p.aberto && p.encerra_em && p.encerra_em.slice(0, 7) === hoje.slice(0, 7)) fim = Math.max(fim, Number(p.encerra_em.slice(8, 10)));
  const mesAno = new Date(Date.UTC(ano, mes - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const nomeMes = mesAno.charAt(0).toUpperCase() + mesAno.slice(1); // "Outubro de 2026"
  const celulas = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(s => `<span class="sem" aria-hidden="true">${s}</span>`);
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push('<span></span>');
  for (let d = 1; d <= diasNoMes; d++) {
    const classes = ['dia'];
    if (d >= p.dia_inicio && d <= fim) classes.push('janela');
    if (d === p.dia_inicio) classes.push('inicio');
    if (d === fim) classes.push('fim');
    if (d < dia) classes.push('passado');
    if (d === dia) classes.push('hoje');
    celulas.push(`<span class="${classes.join(' ')}"${d === dia ? ' aria-current="date"' : ''}>${d}</span>`);
  }
  document.getElementById('cal-mes').innerHTML = `<h3>${nomeMes}</h3><div class="cal-grade">${celulas.join('')}</div>`;

  // Mesmo texto no calendário completo e no resumo ao lado do login.
  let status, titulo, sub;
  if (p.aberto) {
    status = 'Envios abertos';
    titulo = p.dias_restantes === 1 ? 'Último dia para enviar' : `Faltam ${p.dias_restantes} dias para enviar`;
    sub = `Envie até ${dataBR(p.encerra_em)} · competência ${competenciaBR(p.competencia)}`;
  } else {
    status = 'Envios fechados';
    titulo = `Reabre em ${dataBR(p.proxima_abertura)}`;
    sub = `Envios do dia ${dois(p.dia_inicio)} ao dia ${dois(p.dia_fim)} de cada mês. Consultas liberadas.`;
  }
  for (const [prefixo, el] of [['cal', document.getElementById('calendario')], ['res', document.getElementById('prazo-resumo')]]) {
    el.classList.toggle('fechado', !p.aberto);
    document.getElementById(`${prefixo}-status`).textContent = status;
    document.getElementById(`${prefixo}-titulo`).textContent = titulo;
    document.getElementById(`${prefixo}-sub`).textContent = sub;
  }
}

(async function carregarInfo() {
  try {
    const r = await api('/api/publico/info');
    const p = r.periodo;
    document.querySelectorAll('[data-dia-inicio]').forEach(el => { el.textContent = dois(p.dia_inicio); });
    document.querySelectorAll('[data-dia-fim]').forEach(el => { el.textContent = dois(p.dia_fim); });
    document.querySelectorAll('[data-prazo]').forEach(el => { el.textContent = r.prazo_documento_dias; });
    desenharCalendario(r.hoje, p);
    if (r.suspenso) {
      // Portal suspenso pelo administrador: avisa e desabilita o acesso.
      const aviso = document.getElementById('aviso-suspenso');
      aviso.innerHTML = `🚦 <span>${esc(r.suspenso)}</span>`;
      aviso.hidden = false;
      form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
    }
    document.getElementById('lista-beneficios').innerHTML = r.beneficios.map(b => {
      const porDependente = b.escopo === 'dependente_mes' || b.escopo === 'dependente_janela';
      const valor = porDependente
        ? `até ${reais(b.limite_sucedido)}` : `até ${reais(b.limite)}`;
      const regra = b.escopo === 'dependente_mes'
        ? `por dependente/mês (${reais(b.limite_nao_sucedido)} para não sucedidos)`
        : b.escopo === 'dependente_janela'
          ? `por dependente, em fevereiro e julho (${reais(b.limite_nao_sucedido)} para não sucedidos)`
        : b.escopo === 'familia_mes' ? 'por mês, para o grupo familiar' : `por pessoa, a cada ${b.periodo_meses} meses`;
      return `
        <article class="beneficio">
          <span class="ic" aria-hidden="true">${b.icone}</span>
          <h3>${esc(b.nome.replace('Reembolso ', ''))}</h3>
          <span class="valor">${valor}</span>
          <small>${esc(regra)}</small>
        </article>`;
    }).join('');
  } catch {
    document.getElementById('cal-titulo').textContent = 'Envios do dia 01 ao dia 10 de cada mês';
    document.getElementById('res-titulo').textContent = 'Envios do dia 01 ao dia 10 de cada mês';
  }
})();
