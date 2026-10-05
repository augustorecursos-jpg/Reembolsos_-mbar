// Avisos por e-mail ao colaborador (envio, aprovação e reprovação).
// Opcional: só envia quando SMTP_HOST está configurado; caso contrário apenas registra no log.
const nodemailer = require('nodemailer');
const { BENEFICIOS, formatarReais, formatarCompetencia } = require('./regras');

const SMTP_HOST = process.env.SMTP_HOST;
const REMETENTE = process.env.SMTP_FROM || 'Portal de Reembolsos <reembolsos@ambarenergia.com.br>';
const LINK_PORTAL = process.env.PORTAL_URL || '';

const transporte = SMTP_HOST ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;

const emailAtivo = () => Boolean(transporte);

const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function modelo(titulo, linhas, rodape) {
  const tabela = linhas.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5f6f7c">${escHtml(k)}</td><td style="padding:6px 0;font-weight:700;color:#0e3b5c">${escHtml(v)}</td></tr>`).join('');
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #dfe5eb;border-radius:12px;overflow:hidden">
    <div style="background:#0e3b5c;color:#fff;padding:18px 22px;border-bottom:4px solid #ec6b24">
      <div style="font-size:12px;letter-spacing:2px;color:#f39a4a;font-weight:700">PORTAL DE REEMBOLSOS · ÂMBAR ENERGIA</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${escHtml(titulo)}</div>
    </div>
    <div style="padding:20px 22px;color:#1d2b36;font-size:14px">
      <table style="border-collapse:collapse">${tabela}</table>
      ${rodape ? `<p style="margin-top:16px">${rodape}</p>` : ''}
      ${LINK_PORTAL ? `<p style="margin-top:16px"><a href="${escHtml(LINK_PORTAL)}" style="color:#ec6b24;font-weight:700">Acessar o portal</a></p>` : ''}
    </div>
  </div>`;
}

const ASSUNTOS = {
  recebida: 'Solicitação recebida',
  aprovado: 'Solicitação aprovada',
  reprovado: 'Solicitação reprovada',
};

/** Envia o aviso sem travar a requisição; falhas vão para o log. */
function avisar(tipo, sol, destinatario) {
  if (!destinatario) return;
  const linhas = [
    ['Protocolo', sol.protocolo],
    ['Benefício', BENEFICIOS[sol.beneficio]?.nome || sol.beneficio],
    ['Beneficiário', sol.beneficiario_nome],
    ['Competência', formatarCompetencia(sol.competencia)],
    ['Valor solicitado', formatarReais(sol.valor_solicitado)],
  ];
  let rodape = 'Acompanhe o andamento no portal.';
  if (tipo === 'aprovado') {
    linhas.push(['Valor aprovado', formatarReais(sol.valor_aprovado)]);
    rodape = 'O valor aprovado será incluído na folha de pagamento da competência.';
  }
  if (tipo === 'reprovado') {
    linhas.push(['Justificativa do RH', sol.observacao_rh || '']);
    rodape = 'Em caso de dúvidas, procure o time de RH.';
  }
  const assunto = `${ASSUNTOS[tipo]} · ${sol.protocolo}`;
  if (!transporte) {
    console.log(`[e-mail desativado] ${destinatario}: ${assunto}`);
    return;
  }
  transporte.sendMail({ from: REMETENTE, to: destinatario, subject: assunto, html: modelo(ASSUNTOS[tipo], linhas, rodape) })
    .catch(e => console.error(`[e-mail] Falha ao enviar para ${destinatario}: ${e.message}`));
}

module.exports = { avisar, emailAtivo };
