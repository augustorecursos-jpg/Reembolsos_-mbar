// Gera o Guia de Acesso do Portal de Reembolsos (e-book em PDF, A4) a partir das telas em guia/img.
// Uso: node guia/gerar-pdf.js            (requer Playwright: npm i -D playwright)
// Variáveis: PORTAL_URL (endereço exibido no guia). Saída: public/guia-de-acesso.pdf (+ guia/guia.html para conferência).
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const RAIZ = __dirname;
const URL_PORTAL = process.env.PORTAL_URL || 'https://reembolsos-ambar.onrender.com';
const SAIDA = path.join(RAIZ, '..', 'public', 'guia-de-acesso.pdf');
const marcas = JSON.parse(fs.readFileSync(path.join(RAIZ, 'img', 'marcas.json'), 'utf8'));
const R = require('../regras');

const reais = (c) => R.formatarReais(c).replace(/ /g, ' ');
const B = R.BENEFICIOS;

/**
 * Tela com números sobre os pontos explicados.
 * numeros: [[índice em marcas.json, número exibido, ajuste opcional {dx, dy}]]
 * corte (telas de computador, 1366×768): { esq: px a remover à esquerda (menu lateral), foco: [índices], folga: px }
 *   recorta a altura para mostrar só a faixa dos elementos em foco.
 */
const LARG = 1366, ALT = 768;
function tela(nome, numeros = [], { classe = '', legenda = '', corte = null } = {}) {
  const pos = marcas[nome] || [];
  const badges = numeros.map(([i, n, aj = {}]) => {
    const p = pos[i];
    if (!p) return '';
    const x = p.x + (aj.dx || 0), y = p.y + (aj.dy || 0);
    return `<span class="num-tela" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">${n}</span>`;
  }).join('');
  let interno = `<img src="img/${nome}.jpg" alt="">${badges}`;
  let estilo = '';
  if (corte) {
    const esq = corte.esq || 0, folga = corte.folga ?? 40;
    const foco = (corte.foco || pos.map((_, i) => i)).map(i => pos[i]).filter(Boolean);
    let topo = 0, base = ALT;
    if (foco.length) {
      topo = Math.max(0, Math.min(...foco.map(p => (p.y / 100) * ALT)) - folga);
      base = Math.min(ALT, Math.max(...foco.map(p => ((p.y + p.h) / 100) * ALT)) + folga);
    }
    const w = LARG - esq, h = base - topo;
    estilo = `style="aspect-ratio:${w}/${h}"`;
    interno = `<div class="tela-recorte" style="width:${(LARG / w) * 100}%;left:${(-esq / w) * 100}%;top:${(-topo / h) * 100}%">${interno}</div>`;
  }
  return `<figure class="tela ${classe}"><div class="tela-img${corte ? ' recortada' : ''}" ${estilo}>${interno}</div>${legenda ? `<figcaption>${legenda}</figcaption>` : ''}</figure>`;
}

const itens = (lista) => `<ol class="explica">${lista.map(([n, t, d]) => `<li><span class="num">${n}</span><div><strong>${t}</strong>${d ? `<p>${d}</p>` : ''}</div></li>`).join('')}</ol>`;

let pagina = 0;
function folha(titulo, sobretitulo, corpo, { classe = '' } = {}) {
  pagina += 1;
  return `
  <section class="folha ${classe}">
    <header class="folha-topo">
      <span class="marca"><b>Âmbar</b><small>ENERGIA</small></span><span class="produto">Reembolsos</span>
      <span class="guia-nome">Guia de acesso</span>
    </header>
    ${titulo ? `<div class="folha-cab"><span class="sobre">${sobretitulo}</span><h2>${titulo}</h2></div>` : ''}
    <div class="folha-corpo">${corpo}</div>
    <footer class="folha-rodape"><span>Portal de Reembolsos · Recursos Humanos</span><span>${pagina}</span></footer>
  </section>`;
}

const capa = `
<section class="capa">
  <img class="capa-foto" src="img/capa.jpg" alt="">
  <div class="capa-onda"></div>
  <div class="capa-conteudo">
    <div class="capa-marca"><span class="marca claro"><b>Âmbar</b><small>ENERGIA</small></span><span class="produto">Reembolsos</span></div>
    <span class="sobre">GUIA DE ACESSO</span>
    <h1>Portal de <em>Reembolsos</em></h1>
    <p class="capa-sub">Passo a passo para enviar suas solicitações de reembolso e acompanhar a análise do RH.</p>
    <ul class="capa-lista">
      <li>💊 Medicamento</li><li>🎒 Educacional</li><li>🧸 Creche/Babá</li><li>👓 Óculos</li><li>✏️ Material Escolar</li>
    </ul>
  </div>
  <div class="capa-rodape"><span>Recursos Humanos</span><span>${URL_PORTAL.replace(/^https?:\/\//, '')}</span></div>
</section>`;

const sumario = [
  ['Antes de começar', 'O que você precisa e o calendário do mês'],
  ['1. Acesse o portal', 'Entrada com o CPF'],
  ['2. Conheça o seu painel', 'Prazo, saldos e últimas solicitações'],
  ['3. Seus benefícios e limites', 'Quem pode usar, limites e documentos'],
  ['4. Envie uma solicitação', 'Os 5 passos do formulário'],
  ['5. Acompanhe a análise', 'Status, documentos e motivo de reprovação'],
  ['Pelo celular', 'O portal no smartphone'],
  ['Dúvidas frequentes', 'E onde pedir ajuda'],
];

const p1 = folha('Boas-vindas!', 'ANTES DE COMEÇAR', `
  <p class="lead">O <strong>Portal de Reembolsos</strong> reúne em um só lugar as solicitações de reembolso de medicamento, educacional,
  creche/babá, óculos e material escolar/uniforme. Você envia os comprovantes pelo portal, acompanha o saldo de cada benefício e vê o resultado da análise do RH —
  <strong>sem e-mail e sem papel</strong>.</p>

  <div class="duas">
    <div class="caixa">
      <h3>✅ O que você precisa</h3>
      <ul class="checks">
        <li><strong>Seu CPF</strong> — é o único dado pedido para entrar.</li>
        <li><strong>Os documentos digitalizados</strong> em PDF, JPG ou PNG (até 10 MB cada). Foto pelo celular também vale, desde que legível.</li>
        <li><strong>A data e o valor</strong> da nota fiscal ou do comprovante de pagamento.</li>
        <li>Acesso pelo computador ou celular, no endereço:<br><span class="url">${URL_PORTAL}</span></li>
      </ul>
    </div>
    <div class="caixa caixa-marinho">
      <h3>📅 Calendário do mês</h3>
      <ul class="calend">
        <li><b>01 a 10</b><span>Envio das solicitações. Fora desse período o portal fica disponível só para consulta.</span></li>
        <li><b>60 dias</b><span>Prazo máximo entre a emissão do documento e o envio da solicitação.</span></li>
        <li><b>Dia 11</b><span>As solicitações aprovadas seguem para a folha de pagamento do mês.</span></li>
      </ul>
    </div>
  </div>

  <h3 class="tit-sumario">Neste guia</h3>
  <ol class="sumario">${sumario.map(([t, d]) => `<li><strong>${t}</strong><span>${d}</span></li>`).join('')}</ol>
`);

const p2 = folha('Acesse o portal', 'PASSO 1', `
  <p class="lead">Abra <span class="url">${URL_PORTAL}</span> no navegador do computador ou do celular. Na página inicial:</p>
  ${tela('01-home', [[0, 1, { dx: -1.5, dy: -2 }], [1, 2, { dx: -1, dy: -2 }], [2, 3, { dx: -1.5, dy: -2 }], [3, 4, { dx: -1.5, dy: -2 }]])}
  ${itens([
    [1, 'Digite o seu CPF', 'Com ou sem pontos e traço. Não há senha: basta estar na base de colaboradores do RH.'],
    [2, 'Clique em “Acessar →”', 'O portal abre direto no seu painel.'],
    [3, 'Confira o prazo do mês', 'Mostra se os envios estão abertos e quantos dias faltam. Clique para ver o calendário completo.'],
    [4, 'Dúvidas?', 'No topo da página há as seções Benefícios, Como funciona e Dúvidas frequentes.'],
  ])}
  <div class="duas alinhada">
    ${tela('02-home-negado', [[0, '!', { dx: -2, dy: -6 }]], { classe: 'pequena' })}
    <div class="aviso">
      <h3>Apareceu “Acesso negado”?</h3>
      <p>O seu CPF não está na base de elegibilidade do mês (por exemplo, admissão recente ainda não carregada).
      Procure o <strong>time de RH</strong> para verificar o cadastro.</p>
    </div>
  </div>
`);

const p3 = folha('Conheça o seu painel', 'PASSO 2', `
  <p class="lead">Depois de entrar, você vê o resumo dos seus reembolsos. O menu à esquerda leva a todas as áreas do portal.</p>
  ${tela('03-painel', [[0, 1, { dx: -1, dy: -1.5 }], [1, 2, { dx: 0, dy: -1 }], [2, 3, { dx: -1, dy: -3 }], [3, 4, { dx: -1, dy: -2 }], [4, 5, { dx: -1, dy: -1 }], [5, 6, { dx: -1, dy: -1.5 }]])}
  ${itens([
    [1, 'Nova solicitação', 'Abre o formulário para pedir um reembolso (disponível do dia 01 ao 10).'],
    [2, 'Dias restantes', 'Quantos dias faltam para o fim do período de envio do mês.'],
    [3, 'Seus números', 'Solicitações em análise, aprovadas, valor reembolsado no ano e reprovadas.'],
    [4, 'Meus benefícios', 'Só aparecem os benefícios aos quais você tem direito, com o saldo disponível de cada um.'],
    [5, 'Últimas solicitações', 'Status das suas solicitações mais recentes. Clique em uma delas para ver os detalhes.'],
    [6, 'Atalhos dos benefícios', 'No menu, cada benefício mostra o saldo. Clique para ver regras, beneficiários e histórico.'],
  ])}
`);

const linhasBeneficios = [
  ['medicamento', `até ${reais(80000)} por mês para todo o grupo familiar`, 'Titular, cônjuge, filhos e dependentes legais com tutela. Pai e mãe só para colaboradores sucedidos.', 'Receita médica + nota fiscal'],
  ['educacional', `até ${reais(73363)} (sucedidos) ou ${reais(60000)} por dependente/mês`, 'Filhos, enteados e netos com tutela, de 7 a 17 anos, no ensino fundamental, médio ou técnico.', 'Boleto ou recibo + comprovante de pagamento'],
  ['creche', `até ${reais(110317)} (sucedidos) ou ${reais(80000)} por dependente/mês`, 'Filhos, enteados e netos com tutela, de 6 meses a 6 anos.', 'Boleto ou recibo + comprovante de pagamento'],
  ['oculos', `até ${reais(150000)} por pessoa a cada 18 meses`, 'Titular e cônjuge.', 'Receita médica + nota fiscal'],
  ['material', `até ${reais(146726)} (sucedidos) ou ${reais(120000)} por dependente, em fevereiro e em julho`, 'Filhos de 7 a 17 anos. Um reembolso por filho em cada mês; o saldo não acumula.', 'Nota fiscal'],
];
const p4 = folha('Seus benefícios e limites', 'PASSO 3', `
  <p class="lead">Clique em um benefício no menu para ver as regras, os beneficiários elegíveis e o saldo de cada um.</p>
  ${tela('04-beneficio', [[0, 1, { dx: -3, dy: -1 }], [1, 2, { dx: -1.5, dy: -2 }], [2, 3, { dx: -1.5, dy: -2 }]], { classe: 'media', corte: { esq: 280, folga: 24 } })}
  ${itens([
    [1, 'Saldo disponível', 'Quanto ainda pode ser reembolsado no período.'],
    [2, 'Regras do benefício', 'Quem pode usar, documentos obrigatórios, prazos e itens não cobertos.'],
    [3, 'Beneficiários e saldos', 'Limite, valor utilizado e disponível de cada pessoa. Use “Solicitar” para começar direto por ela.'],
  ])}
  <table class="tabela-regras">
    <tr><th>Benefício</th><th>Limite</th><th>Quem pode usar</th><th>Documentos</th></tr>
    ${linhasBeneficios.map(([c, l, q, d]) => `<tr><td><span class="ic">${B[c].icone}</span>${B[c].curto}</td><td>${l}</td><td>${q}</td><td>${d}</td></tr>`).join('')}
  </table>
  <p class="nota">Medicamento: não cobre estética, beleza, higiene pessoal ou suplementos. Valores conforme a política vigente, que pode ser atualizada pelo RH.</p>
`);

const p5 = folha('Envie uma solicitação (1/2)', 'PASSO 4', `
  <p class="lead">Em <strong>Nova solicitação</strong>, o formulário tem 5 passos. Os dados cadastrais vêm preenchidos pela base do RH.</p>
  ${tela('05-nova-passos12', [[0, 1, { dx: -1.2, dy: -2 }], [1, 2, { dx: -1.2, dy: -2 }]], { corte: { esq: 280, folga: 14 } })}
  ${itens([
    [1, 'Escolha o benefício', 'Aparecem apenas os benefícios aos quais você tem direito, com o saldo de cada um.'],
    [2, 'Escolha o beneficiário', 'Você mesmo ou o dependente da despesa. Quem não tem saldo aparece desabilitado.'],
  ])}
  ${tela('06-nova-erro-saldo', [[0, 3, { dx: -1.2, dy: -3.5 }], [1, 4, { dx: -1.2, dy: -3.5 }], [2, '!', { dx: -2.5, dy: -0.5 }]], { corte: { esq: 280, folga: 50 } })}
  ${itens([
    [3, 'Data de emissão do documento', 'Data da nota fiscal ou do comprovante. Documentos com mais de 60 dias não são aceitos.'],
    [4, 'Valor da despesa', 'Digite só os números (ex.: 45000 vira 450,00). O saldo disponível aparece logo abaixo.'],
    ['!', 'Avisos na hora', 'Se o valor passar do saldo ou a data estiver fora do prazo, o portal avisa antes do envio.'],
  ])}
`);

const p6 = folha('Envie uma solicitação (2/2)', 'PASSO 4', `
  ${tela('07-nova-despesa-anexos', [[2, 5, { dx: -1, dy: -3 }], [3, 6, { dx: -1, dy: -3 }]], { corte: { esq: 280, foco: [2, 3], folga: 70 } })}
  ${itens([
    [5, 'Anexe os documentos obrigatórios', 'Marcados com *. Clique no quadro ou arraste o arquivo. O quadro fica verde quando o arquivo é aceito.'],
    [6, 'Outros documentos (opcional)', 'Use se quiser complementar a solicitação.'],
  ])}
  ${tela('08-nova-confirmar', [[0, 7, { dx: -5.5, dy: 2 }], [1, 8, { dx: -5, dy: 0 }], [2, 9, { dx: -4.5, dy: 2 }]], { classe: 'media' })}
  ${itens([
    [7, 'Confira seus dados', 'Matrícula, CPF, unidade e competência vêm da base do RH.'],
    [8, 'Marque a declaração', 'Confirma que as informações e os documentos são verdadeiros.'],
    [9, 'Envie', 'Pronto! Você recebe um número de protocolo e a solicitação fica “Em análise”.'],
  ])}
  <div class="duas alinhada">
    ${tela('09-enviada', [], { classe: 'pequena', corte: { esq: 280, foco: [0], folga: 120 } })}
    <div class="aviso aviso-ok"><h3>Guarde o protocolo</h3><p>Ele identifica a sua solicitação. Se o e-mail estiver cadastrado na base do RH, você também recebe a confirmação por e-mail.</p></div>
  </div>
`);

const p7 = folha('Acompanhe a análise', 'PASSO 5', `
  <p class="lead">Em <strong>Minhas solicitações</strong> você vê todas as solicitações e o status de cada uma.</p>
  ${tela('10-minhas', [[0, 1, { dx: -3, dy: 0.5 }], [2, 2, { dx: -1, dy: -3 }], [1, 3, { dx: -3.5, dy: 0 }]], { corte: { esq: 280, folga: 20 } })}
  ${itens([
    [1, 'Filtros', 'Filtre por status ou por benefício.'],
    [2, 'Clique na solicitação', 'Abre os detalhes: valores, documentos enviados e o andamento com datas.'],
    [3, 'Status', 'Veja abaixo o que cada um significa.'],
  ])}
  <div class="status-lista">
    <div><span class="etq analise">Em análise</span><p>O RH está conferindo a solicitação e os documentos.</p></div>
    <div><span class="etq ok">Aprovado</span><p>O valor aprovado vai para a folha de pagamento da competência.</p></div>
    <div><span class="etq nao">Reprovado</span><p>O motivo aparece logo abaixo da solicitação. Corrija e envie uma nova, se ainda estiver no prazo.</p></div>
  </div>
  ${tela('12-reprovada', [[0, '!', { dx: -1.5, dy: -5 }]], { corte: { esq: 280, folga: 85 } })}
`);

const p8 = folha('Pelo celular', 'NO SMARTPHONE', `
  <p class="lead">O portal funciona no navegador do celular, sem instalar nada. É o jeito mais prático de fotografar e anexar os comprovantes.</p>
  <div class="celulares">
    ${tela('13-cel-home', [[0, 1, { dx: -3, dy: -1.5 }], [1, 2, { dx: -3, dy: -1.5 }]], { classe: 'celular', legenda: 'Digite o CPF e toque em Acessar' })}
    ${tela('14-cel-painel', [[0, 3, { dx: -4, dy: 0 }]], { classe: 'celular', legenda: 'Seu painel' })}
    ${tela('15-cel-menu', [[0, 4, { dx: -3, dy: -1 }], [1, 5, { dx: -3, dy: -1 }]], { classe: 'celular', legenda: 'Menu com todas as áreas' })}
  </div>
  ${itens([
    [1, 'CPF', 'O teclado numérico abre sozinho.'],
    [2, 'Acessar', 'Toque para entrar.'],
    [3, 'Menu (☰)', 'Toque no ícone do canto superior esquerdo para abrir o menu.'],
    [4, 'Nova solicitação', 'Na hora de anexar, escolha “Câmera” para fotografar o documento ou selecione o arquivo.'],
    [5, 'Minhas solicitações', 'Acompanhe o status de qualquer lugar.'],
  ])}
`);

const faq = [
  ['Preciso de senha?', 'Não. O acesso é feito somente com o CPF, para colaboradores da base de elegibilidade do RH.'],
  ['Perdi o prazo do dia 10. E agora?', 'O envio reabre no dia 01 do mês seguinte. Lembre que o documento precisa ter no máximo 60 dias na data do envio.'],
  ['Não encontro um dependente ou um benefício.', 'O portal mostra apenas quem é elegível, conforme as regras e a base do RH. Se houver divergência, procure o RH.'],
  ['O valor passou do saldo. Posso enviar?', 'Não. Ajuste o valor solicitado para até o saldo disponível mostrado no formulário.'],
  ['Posso enviar foto do documento?', 'Sim, em JPG ou PNG, desde que esteja legível e inteiro. PDF também é aceito. Até 10 MB por arquivo.'],
  ['Minha solicitação foi reprovada.', 'Veja o motivo em “Minhas solicitações”, corrija o que foi indicado e envie uma nova solicitação dentro do prazo.'],
  ['Quando recebo o valor?', 'As solicitações aprovadas seguem para a folha de pagamento da competência.'],
];
const p9 = folha('Dúvidas frequentes', 'AJUDA', `
  <div class="faq">${faq.map(([p, r]) => `<div class="faq-item"><strong>${p}</strong><p>${r}</p></div>`).join('')}</div>
  <div class="checklist">
    <h3>Antes de enviar, confira</h3>
    <ul class="checks">
      <li>Estamos entre os dias <strong>01 e 10</strong> do mês.</li>
      <li>O documento tem <strong>até 60 dias</strong> da emissão.</li>
      <li>Os documentos obrigatórios estão <strong>legíveis e completos</strong>.</li>
      <li>O valor está dentro do <strong>saldo disponível</strong>.</li>
    </ul>
  </div>
  <div class="ajuda">
    <h3>Precisa de ajuda?</h3>
    <p>Procure o <strong>time de Recursos Humanos</strong> da sua unidade. Tenha em mãos o <strong>número do protocolo</strong> da solicitação, se já tiver enviado.</p>
    <span class="url">${URL_PORTAL}</span>
  </div>
`);

const fonte = (f) => `url('fontes/${f}') format('woff')`;
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Guia de acesso · Portal de Reembolsos</title>
<style>
@font-face { font-family: 'Montserrat'; font-weight: 400; src: ${fonte('montserrat-latin-400-normal.woff')}; }
@font-face { font-family: 'Montserrat'; font-weight: 700; src: ${fonte('montserrat-latin-700-normal.woff')}; }
@font-face { font-family: 'Montserrat'; font-weight: 800; src: ${fonte('montserrat-latin-800-normal.woff')}; }
@font-face { font-family: 'Nunito Sans'; font-weight: 400; src: ${fonte('nunito-sans-latin-400-normal.woff')}; }
@font-face { font-family: 'Nunito Sans'; font-weight: 700; src: ${fonte('nunito-sans-latin-700-normal.woff')}; }
:root { --marinho: #0e3b5c; --marinho-2: #164d74; --laranja: #ec6b24; --teal: #0b7a75; --teal-claro: #4cc3b8; --teal-suave: #e2f3f1;
  --fundo: #f4f6f8; --linha: #dfe5eb; --texto: #1d2b36; --suave: #5f6f7c; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Nunito Sans', system-ui, sans-serif; color: var(--texto); font-size: 10.2pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { font-family: 'Montserrat', sans-serif; color: var(--marinho); margin: 0; }
.marca { display: inline-flex; flex-direction: column; line-height: .95; }
.marca b { font-family: 'Montserrat'; font-weight: 700; font-size: 15pt; color: var(--marinho); }
.marca small { font-family: 'Montserrat'; font-weight: 700; font-size: 5.6pt; letter-spacing: .14em; color: var(--laranja); margin-left: 1px; }
.marca.claro b { color: #fff; }
.produto { font-family: 'Montserrat'; font-weight: 700; color: var(--teal); padding-left: 8px; margin-left: 8px; border-left: 1px solid var(--linha); font-size: 10.5pt; }
.url { display: inline-block; font-family: 'Montserrat'; font-weight: 700; color: var(--teal); background: var(--teal-suave); padding: 1px 8px; border-radius: 6px; }

/* Capa */
.capa { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: var(--marinho); color: #dce7f0; page-break-after: always; }
.capa-foto { position: absolute; right: -10mm; bottom: 0; width: 170mm; height: 172mm; object-fit: cover; object-position: 40% 20%; opacity: .95;
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 35%), linear-gradient(0deg, #000 70%, transparent 100%); -webkit-mask-composite: source-in; }
.capa-onda { position: absolute; left: 0; right: 0; bottom: 0; height: 60mm;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 420 150' preserveAspectRatio='none'%3E%3Cpath d='M0 40C120 90 260 150 420 110V150H0Z' fill='%23164d74'/%3E%3Cpath d='M0 30C120 80 260 140 420 100' fill='none' stroke='%234cc3b8' stroke-width='2'/%3E%3C/svg%3E") bottom / 100% 100% no-repeat; }
.capa-conteudo { position: relative; padding: 26mm 20mm 0; max-width: 150mm; }
.capa-marca { display: flex; align-items: center; margin-bottom: 30mm; }
.capa-marca .produto { color: var(--teal-claro); border-left-color: rgba(255,255,255,.25); font-size: 13pt; }
.capa .sobre { font-family: 'Montserrat'; font-weight: 700; letter-spacing: .2em; font-size: 9pt; color: var(--teal-claro); }
.capa h1 { color: #fff; font-size: 40pt; line-height: 1.02; margin: 4mm 0 6mm; font-weight: 800; letter-spacing: -.02em; }
.capa h1 em { display: block; font-style: normal; color: var(--teal-claro); }
.capa-sub { font-size: 13pt; line-height: 1.45; max-width: 105mm; margin: 0 0 8mm; padding-left: 4mm; border-left: 3px solid var(--teal-claro); color: #fff; }
.capa-lista { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, max-content); gap: 2.5mm 6mm; font-weight: 700; color: #fff; font-size: 11pt; }
.capa-rodape { position: absolute; left: 20mm; right: 20mm; bottom: 12mm; display: flex; justify-content: space-between; color: #fff; font-family: 'Montserrat'; font-weight: 700; font-size: 9pt; }

/* Páginas internas */
.folha { position: relative; width: 210mm; height: 297mm; padding: 14mm 16mm 16mm; overflow: hidden; page-break-after: always; display: flex; flex-direction: column; }
.folha:last-child { page-break-after: auto; }
.folha-topo { display: flex; align-items: center; padding-bottom: 4mm; border-bottom: 1px solid var(--linha); margin-bottom: 6mm; }
.folha-topo .guia-nome { margin-left: auto; font-family: 'Montserrat'; font-weight: 700; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--suave); }
.folha-cab { margin-bottom: 4mm; }
.folha-cab .sobre { font-family: 'Montserrat'; font-weight: 700; font-size: 8.5pt; letter-spacing: .18em; color: var(--teal); }
.folha-cab h2 { font-size: 21pt; font-weight: 800; margin-top: 1mm; }
.folha-corpo { flex: 1; display: flex; flex-direction: column; gap: 4mm; }
.folha-rodape { display: flex; justify-content: space-between; padding-top: 3mm; border-top: 1px solid var(--linha); font-size: 8pt; color: var(--suave); }
.folha-rodape span:last-child { font-family: 'Montserrat'; font-weight: 800; color: var(--marinho); }
.lead { font-size: 11pt; margin: 0; }
.nota { font-size: 8.5pt; color: var(--suave); margin: 0; }

/* Telas com números */
.tela { margin: 0; }
.tela-img { position: relative; border-radius: 3mm; overflow: hidden; border: 1px solid var(--linha); box-shadow: 0 3mm 7mm -4mm rgba(14,59,92,.35); }
.tela-img img { display: block; width: 100%; height: auto; }
.tela-img.recortada { position: relative; }
.tela-recorte { position: absolute; }
.tela.media { width: 72%; align-self: center; }
.tela.pequena { width: 100%; }
.tela figcaption { text-align: center; font-size: 8.5pt; color: var(--suave); margin-top: 2mm; font-weight: 700; }
.num-tela { position: absolute; width: 7.5mm; height: 7.5mm; border-radius: 50%; display: grid; place-items: center; background: var(--laranja); color: #fff;
  font-family: 'Montserrat'; font-weight: 800; font-size: 10pt; border: 2px solid #fff; box-shadow: 0 1mm 2.5mm rgba(0,0,0,.35); }
.explica { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm 6mm; }
.explica li { display: flex; gap: 2.5mm; align-items: flex-start; }
.explica .num, .sumario li::before { flex-shrink: 0; width: 6.5mm; height: 6.5mm; border-radius: 50%; display: grid; place-items: center; background: var(--laranja); color: #fff; font-family: 'Montserrat'; font-weight: 800; font-size: 9pt; }
.explica strong { color: var(--marinho); font-family: 'Montserrat'; font-size: 9.6pt; }
.explica p { margin: .5mm 0 0; font-size: 9pt; color: var(--texto); }

.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.duas.alinhada { align-items: center; }
.caixa { border: 1px solid var(--linha); border-radius: 3mm; padding: 5mm; background: #fff; }
.caixa h3 { font-size: 12pt; margin-bottom: 3mm; }
.caixa-marinho { background: var(--marinho); border-color: var(--marinho); color: #dce7f0; }
.caixa-marinho h3 { color: #fff; }
.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 2.5mm; }
.checks li { position: relative; padding-left: 6mm; }
.checks li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 4.5mm; height: 4.5mm; border-radius: 50%; background: var(--teal); color: #fff; font-size: 7pt; display: grid; place-items: center; font-weight: 800; }
.calend { list-style: none; padding: 0; margin: 0; display: grid; gap: 3mm; }
.calend li { display: grid; grid-template-columns: 19mm 1fr; gap: 3mm; align-items: center; }
.calend b { font-family: 'Montserrat'; font-weight: 800; color: var(--marinho); background: var(--teal-claro); border-radius: 2mm; text-align: center; padding: 2mm 0; font-size: 10pt; }
.tit-sumario { font-size: 13pt; margin-top: 2mm; }
.sumario { list-style: none; counter-reset: s; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; }
.sumario li { counter-increment: s; display: grid; grid-template-columns: 6.5mm 1fr; column-gap: 3mm; align-items: start; padding: 3mm; border-radius: 2.5mm; background: var(--fundo); }
.sumario li::before { content: counter(s); grid-row: span 2; }
.sumario strong { color: var(--marinho); font-family: 'Montserrat'; }
.sumario span { font-size: 9pt; color: var(--suave); }
.aviso { border-left: 4px solid var(--laranja); background: #fdf0e7; padding: 4mm 5mm; border-radius: 2mm; }
.aviso h3 { font-size: 11pt; margin-bottom: 1.5mm; }
.aviso p { margin: 0; font-size: 9.4pt; }
.aviso-ok { border-left-color: var(--teal); background: var(--teal-suave); }

.tabela-regras { width: 100%; border-collapse: collapse; font-size: 8.3pt; line-height: 1.35; }
.tabela-regras th { background: var(--marinho); color: #fff; text-align: left; padding: 2mm 2.5mm; font-family: 'Montserrat'; font-size: 8pt; }
.tabela-regras td { padding: 1.5mm 2.5mm; border-bottom: 1px solid var(--linha); vertical-align: top; }
.tabela-regras tr:nth-child(odd) td { background: var(--fundo); }
.tabela-regras td:first-child { font-weight: 700; color: var(--marinho); white-space: nowrap; }
.tabela-regras .ic { margin-right: 1.5mm; }

.status-lista { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
.status-lista div { border: 1px solid var(--linha); border-radius: 2.5mm; padding: 3mm; }
.status-lista p { margin: 1.5mm 0 0; font-size: 8.8pt; }
.etq { display: inline-block; padding: .6mm 2.5mm; border-radius: 99px; font-weight: 700; font-size: 8.5pt; }
.etq.analise { background: #fff4e0; color: #8a5300; }
.etq.ok { background: #e3f5eb; color: #177a44; }
.etq.nao { background: #fdecea; color: #b42d20; }

.celulares { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7mm; padding: 0 4mm; }
.tela.celular .tela-img { border-radius: 6mm; border: 2.5mm solid #1b2733; box-shadow: 0 4mm 8mm -4mm rgba(0,0,0,.45); }

.faq { display: grid; grid-template-columns: 1fr 1fr; gap: 3.5mm 6mm; }
.faq-item { border: 1px solid var(--linha); border-radius: 2.5mm; padding: 3.5mm; }
.faq-item strong { color: var(--marinho); font-family: 'Montserrat'; font-size: 9.6pt; }
.faq-item p { margin: 1.2mm 0 0; font-size: 9pt; }
.checklist { border-radius: 3mm; background: var(--teal-suave); padding: 5mm; }
.checklist h3 { font-size: 12pt; margin-bottom: 3mm; }
.ajuda { border-radius: 3mm; background: var(--marinho); color: #dce7f0; padding: 6mm; }
.ajuda h3 { color: #fff; font-size: 14pt; margin-bottom: 2mm; }
.ajuda p { margin: 0 0 3mm; }
.ajuda strong { color: #fff; }
</style></head>
<body>
${capa}
${p1}${p2}${p3}${p4}${p5}${p6}${p7}${p8}${p9}
</body></html>`;

(async () => {
  const arquivoHtml = path.join(RAIZ, 'guia.html');
  fs.writeFileSync(arquivoHtml, html);
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + arquivoHtml, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  // Confere se alguma página estourou a altura do A4.
  const estouradas = await p.evaluate(() => [...document.querySelectorAll('.folha')].map((f, i) => (f.scrollHeight > f.clientHeight + 2 ? i + 2 : 0)).filter(Boolean));
  if (estouradas.length) console.warn('[aviso] conteúdo maior que a página nas folhas:', estouradas.join(', '));
  await p.pdf({ path: SAIDA, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('PDF gerado em', path.relative(process.cwd(), SAIDA));
})();
