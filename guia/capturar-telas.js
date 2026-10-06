// Captura as telas do portal usadas no Guia de Acesso (guia/gerar-pdf.js).
// Uso: com o portal rodando com os dados de demonstração (npm run seed && PORT=3020 npm start):
//   node guia/capturar-telas.js [pasta-de-saída]     (requer Playwright: npm i -D playwright)
// Depois converta as PNG para JPG em guia/img e copie o marcas.json (posições dos números nas telas).
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'telas-png'), B = process.env.PORTAL || 'http://localhost:3020';
fs.mkdirSync(OUT, { recursive: true });
const S = OUT; // documentos de exemplo para os anexos
fs.writeFileSync(path.join(S, 'receita.pdf'), '%PDF-1.4 exemplo'); fs.writeFileSync(path.join(S, 'nota.pdf'), '%PDF-1.4 exemplo');
const marcas = {};
(async () => {
  const b = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } }); const erros = [];
  const ctx = async (w, h) => { const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }); const p = await c.newPage(); p.on('pageerror', e => erros.push(e.message)); return p; };
  // Posições (em % da captura) dos elementos que vão receber os números no e-book.
  const pos = async (p, seletores, clip) => {
    const r = [];
    for (const sel of seletores) {
      const bb = await p.locator(sel).first().boundingBox();
      if (!bb) { r.push(null); continue; }
      const cx = clip ? clip : { x: 0, y: 0, width: p.viewportSize().width, height: p.viewportSize().height };
      r.push({ x: +(((bb.x - cx.x) / cx.width) * 100).toFixed(2), y: +(((bb.y - cx.y) / cx.height) * 100).toFixed(2), w: +((bb.width / cx.width) * 100).toFixed(2), h: +((bb.height / cx.height) * 100).toFixed(2) });
    }
    return r;
  };
  const foto = async (p, nome, seletores = [], clip) => {
    marcas[nome] = await pos(p, seletores, clip);
    await p.screenshot({ path: `${OUT}/${nome}.png`, ...(clip ? { clip } : {}) });
  };

  let p = await ctx(1366, 768);
  await p.goto(B + '/'); await p.waitForTimeout(800);
  await foto(p, '01-home', ['#cpf', '#acesso button', '#prazo-resumo', '.menu a[href="#duvidas"]']);
  await p.fill('#cpf', '000.000.000-00'); await p.click('#acesso button'); await p.waitForTimeout(500);
  const bb = await p.locator('#acesso').boundingBox();
  await foto(p, '02-home-negado', ['#acesso-msg'], { x: Math.round(bb.x - 16), y: Math.round(bb.y - 16), width: Math.round(bb.width + 32), height: Math.round(bb.height + 32) });
  await p.fill('#cpf', '123.456.789-09'); await p.click('#acesso button'); await p.waitForURL('**/portal.html'); await p.waitForTimeout(1500);
  await foto(p, '03-painel', ['.lateral [data-rota="nova"]', '.anel', '.indicadores', '.temas .tema', '.grade-painel > section:last-child', '#lista-modulos']);
  await p.click('.lateral [data-beneficio="medicamento"]'); await p.waitForTimeout(600);
  await foto(p, '04-beneficio', ['.tema-cab .progresso', '.regras-grade', '.tabela']);
  // Nova solicitação
  await p.click('.lateral [data-rota="nova"]'); await p.waitForTimeout(500);
  await p.click('label.opcao-cartao:has(input[value="oculos"])'); await p.waitForTimeout(300);
  await p.click('label.opcao-cartao:has(input[name="beneficiario"][value="0"])'); await p.waitForTimeout(300);
  await p.evaluate(() => window.scrollTo(0, 0));
  await foto(p, '05-nova-passos12', ['#form-sol fieldset:nth-of-type(1)', '#passo-beneficiario']);
  await p.fill('#data-doc', '2026-09-28'); await p.dispatchEvent('#data-doc', 'change'); await p.waitForTimeout(300);
  await p.type('#valor', '70000'); await p.waitForTimeout(400);
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('passo-despesa').scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -110, behavior: 'instant' }); }); await p.waitForTimeout(300);
  await foto(p, '06-nova-erro-saldo', ['#data-doc', '#valor', '#alerta-despesa .alerta']);
  await p.fill('#valor', ''); await p.type('#valor', '45000');
  await p.setInputFiles('input[name="receita"]', S + '/receita.pdf');
  await p.setInputFiles('input[name="nota_fiscal"]', S + '/nota.pdf');
  await p.fill('input[name="descricao"]', 'Armação e lentes de grau');
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('passo-despesa').scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -110, behavior: 'instant' }); }); await p.waitForTimeout(300);
  await foto(p, '07-nova-despesa-anexos', ['#data-doc', '#valor', '#anexos .anexo-campo:nth-child(1)', '#anexos .anexo-campo:nth-child(3)']);
  await p.check('#declaracao');
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('passo-confirmar').scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -110, behavior: 'instant' }); }); await p.waitForTimeout(300);
  {
    const el = p.locator('#passo-confirmar'); const bb = await el.boundingBox();
    const rel = async (sel) => { const r = await p.locator(sel).first().boundingBox(); return { x: +(((r.x - bb.x) / bb.width) * 100).toFixed(2), y: +(((r.y - bb.y) / bb.height) * 100).toFixed(2), w: +((r.width / bb.width) * 100).toFixed(2), h: +((r.height / bb.height) * 100).toFixed(2) }; };
    marcas['08-nova-confirmar'] = [await rel('#passo-confirmar .dados-cad'), await rel('#passo-confirmar .declaracao'), await rel('#btn-enviar')];
    await el.screenshot({ path: `${OUT}/08-nova-confirmar.png` });
  }
  await p.click('#btn-enviar'); await p.waitForTimeout(900);
  await foto(p, '09-enviada', ['.conteudo .cartao strong']);
  await p.click('main a[href="#/minhas"]'); await p.waitForTimeout(600);
  await foto(p, '10-minhas', ['#f-status', '.sol-item:nth-child(1) .valor', '.sol-item:nth-child(1)']);
  await p.click('.sol-item:nth-child(1)'); await p.waitForTimeout(500);
  await foto(p, '11-detalhe', ['.anexos-lista', '.linha-tempo']);
  // Reprovada com motivo (João)
  p = await ctx(1366, 768);
  await p.goto(B + '/'); await p.fill('#cpf', '98765432100'); await p.click('#acesso button'); await p.waitForURL('**/portal.html'); await p.waitForTimeout(1200);
  await p.goto(B + '/portal.html#/minhas'); await p.waitForTimeout(800);
  await foto(p, '12-reprovada', ['.sol-item .obs']);
  // Celular
  p = await ctx(390, 844);
  await p.goto(B + '/'); await p.waitForTimeout(800);
  await foto(p, '13-cel-home', ['#cpf', '#acesso button']);
  await p.fill('#cpf', '12345678909'); await p.click('#acesso button'); await p.waitForURL('**/portal.html'); await p.waitForTimeout(1300);
  await foto(p, '14-cel-painel', ['#btn-menu']);
  await p.click('#btn-menu'); await p.waitForTimeout(500);
  await foto(p, '15-cel-menu', ['.lateral [data-rota="nova"]', '.lateral [data-rota="minhas"]']);
  fs.writeFileSync(OUT + '/marcas.json', JSON.stringify(marcas, null, 1));
  console.log('ERROS', JSON.stringify(erros)); await b.close();
})();
