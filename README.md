# Portal de Reembolsos · Âmbar Energia (RH)

Portal para recebimento, análise, aprovação e controle das solicitações de reembolso dos colaboradores
(**medicamento, educacional, creche/babá e óculos**), conforme o *Documento de Requisitos – Portal de Reembolso*.
Substitui o envio de documentos por e-mail, mantém o histórico rastreável e gera a base mensal para a folha de pagamento.

Mesma arquitetura e identidade visual da plataforma de treinamento (Trilha DHO, repositório `DHO-mbar`):
Node.js + SQLite nativo, HTML/CSS/JS puro, lateral azul-marinho, home com a foto da equipe e cores da marca.
É um serviço **independente** (banco, senhas e publicação próprios).

## Ver o portal antes de publicar (GitHub Codespaces)

Sem instalar nada no computador:

1. No GitHub, abra este repositório → botão verde **Code** → aba **Codespaces** → **Create codespace on main**.
2. Aguarde 1 a 3 minutos: o ambiente instala tudo, cria os dados de demonstração e inicia o portal.
3. O portal abre sozinho em uma nova aba (se não abrir: aba **PORTS** na parte de baixo → porta **3001** → ícone do globo).
4. Use os acessos de demonstração abaixo. Ao terminar, pare o codespace em github.com/codespaces (contas pessoais têm horas gratuitas por mês).

O link do codespace é privado (só funciona logado na sua conta do GitHub). Os dados são apenas de teste.

## Como rodar (no próprio computador)

Requisito: **Node.js 22.5+**.

```bash
npm install
npm run seed      # opcional: base e solicitações de demonstração
npm start         # http://localhost:3001
npm test          # testes das regras de negócio
```

Demonstração (após `npm run seed`) — colaborador entra com o **CPF**:

| CPF | Perfil |
|---|---|
| 123.456.789-09 | Sucedida, com cônjuge, 2 filhos e mãe |
| 987.654.321-00 | Não sucedido, com cônjuge, enteada, filho e mãe |
| 111.444.777-35 | Não sucedida, sem dependentes |

Área do RH (`/admin.html`): usuário `admin`, senha de `ADMIN_PASSWORD` (padrão local `ambar-rh`).

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha inicial do usuário `admin` do RH (usada só na primeira execução) | `ambar-rh` (**obrigatória em produção**) |
| `PORT` | Porta HTTP | `3001` |
| `DATA_DIR` | Pasta do banco (`reembolsos.db`) e dos documentos anexados | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `data/` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Avisos por e-mail (opcional; sem `SMTP_HOST` os avisos só vão para o log) | – |
| `PORTAL_URL` | Link do portal incluído nos e-mails | – |
| `NODE_ENV=production` | Cookies só via HTTPS e senha obrigatória | – |

## Fluxo

1. **RH importa a base mensal** (Base de elegibilidade): planilha de colaboradores e de dependentes
   (modelo em Excel com as abas Instruções, Colaboradores e Dependentes em `public/exemplos/base-elegibilidade-modelo.xlsx`; também aceita CSV). Modo *adicionar/atualizar* ou *substituir* (quem sai da planilha perde o acesso;
   o histórico permanece). Cada carga fica registrada.
2. **Colaborador acessa** com o CPF. Vê apenas os benefícios e os dependentes elegíveis, com o saldo de cada um.
3. **Nova solicitação** em 5 passos: benefício → beneficiário → data e valor do documento → anexos obrigatórios →
   confirmação (dados cadastrais preenchidos pela base + declaração). Validações na tela e no servidor.
4. **RH analisa**: filtros por competência, status, benefício, empresa, unidade, período e busca; vê anexos, saldo do limite
   e histórico do beneficiário; **aprova** (total ou parcial) ou **reprova** (justificativa obrigatória, exibida ao colaborador).
   Decisões podem ser reabertas com motivo. Tudo fica na linha do tempo com data, hora e responsável.
5. **Colaborador acompanha** o status (Em análise / Aprovado / Reprovado) e recebe e-mail no envio e na decisão (se SMTP configurado).
6. **Dia 11 – Folha de pagamento**: o RH extrai as aprovadas da competência em **CSV** (`;`, vírgula decimal, pronto para o
   Excel/importação) ou **Excel**, com matrícula, nome, CPF, empresa, unidade, benefício, beneficiário, competência,
   valor aprovado, verba de folha, data da aprovação e status. O sistema avisa se ainda houver solicitações em análise.

## Regras implementadas

| Regra | Como funciona |
|---|---|
| Período | Novas solicitações do dia **01 ao 10**; a partir do dia 11 o portal fica só para consulta. Dias configuráveis e “abertura excepcional até” uma data. |
| Prazo do documento | Até **60 dias** da emissão; data futura bloqueada. Configurável. |
| Anexos | Obrigatórios por benefício (PDF/JPG/PNG, até 10 MB cada); sem eles o envio não conclui. |
| Medicamento | Até **R$ 800,00/mês para o grupo familiar** (limite compartilhado). Titular, cônjuge, filhos, netos/dependentes com tutela; **pai e mãe só para sucedidos**. Declaração de que não são itens de estética, higiene ou suplementos. |
| Educacional | Por dependente/mês: **R$ 733,63** (sucedido) / **R$ 600,00** (não sucedido). Filhos, enteados e netos com tutela, **7 a 17 anos resguardado o ano letivo** (quem faz 18 no ano segue elegível até dezembro). Nível de ensino obrigatório. |
| Creche/Babá | Por dependente/mês: **R$ 1.103,17** (sucedido) / **R$ 800,00** (não sucedido). Filhos, enteados e netos com tutela, **de 6 meses a 6 anos**. |
| Óculos | **R$ 1.500,00 por beneficiário a cada 18 meses** (pela data do documento). Somente titular e cônjuge. |
| Saldo | Aprovadas contam pelo valor aprovado e **em análise pelo valor solicitado** (evita enviar acima do limite enquanto a análise não sai); reprovadas liberam o saldo. O RH não consegue aprovar acima do saldo. |
| Sucedido | Coluna `SUCEDIDO` (S/N) da base; se vazia, sucedido = admitido até 31/12/2011. |
| Elegibilidade da base | Colunas `MEDICAMENTO`, `EDUCACIONAL`, `CRECHE`, `OCULOS` em colaboradores e dependentes: **S** libera (ex.: exceções aprovadas pelo RH), **N** bloqueia, **vazio** aplica a regra do benefício. |
| Desligados | Removidos na carga *substituir* (ou bloqueados manualmente). `DATA_DESLIGAMENTO` impede documentos posteriores a ela. |
| Limites e verbas | Editáveis em Configurações (reajustes de valores e código da verba de folha de cada benefício). |

Os dados cadastrais (matrícula, empresa, unidade, perfil) são **copiados na solicitação** no momento do envio, para o relatório
da folha não mudar quando a base do mês seguinte for importada. Dependentes são identificados entre cargas pelo CPF
(ou nome + data de nascimento), preservando o histórico de limites.

## Segurança

- Colaborador: CPF (como na Trilha DHO), sessão de 8 h, limite de tentativas com falha por IP.
- RH: usuários individuais (senha com scrypt), cadastrados em Configurações — o nome de quem analisou fica registrado.
- Documentos anexados ficam fora da pasta pública e só são entregues ao próprio colaborador ou ao RH.
- Botão de backup do banco em Configurações; os anexos ficam em `DATA_DIR/anexos` (incluídos no snapshot do disco).

## Pontos para validar com o RH (seção 11 do documento)

- **Autenticação**: hoje só o CPF. Para mais segurança, dá para pedir também a matrícula ou a data de nascimento; se houver Azure AD/Microsoft 365, dá para trocar por login corporativo (SSO).
- **Colaboradores admitidos entre 2012 e 11/2024**: o documento só define limites para sucedidos (até 2011) e não sucedidos
  (a partir de 12/2024). Sem a coluna `SUCEDIDO`, esse grupo é tratado como não sucedido — confirmar a regra.
- **Faixas etárias**: “até 6 anos” (creche) foi tratado como até a véspera do 7º aniversário; “7 anos” (educacional) a partir do aniversário de 7.
- **Layout da folha**: o CSV segue os campos mínimos da seção 9; se o sistema de folha exigir um layout fixo, basta ajustar `linhasDaFolha` em `server.js`.
- **Retenção dos documentos**: definir o prazo de guarda (hoje nada é apagado automaticamente).

## Publicação

**Render** – `render.yaml` na raiz (New → Blueprint → este repositório). Plano Starter + disco de 10 GB.
**Docker** – `docker build -t reembolsos . && docker run -d -p 3000:3000 -v reembolsos-dados:/data -e ADMIN_PASSWORD=... reembolsos`,
com um proxy HTTPS na frente.

## Estrutura

```
server.js        API (colaborador, RH), validações e arquivos estáticos
regras.js        regras dos benefícios: período, prazo, elegibilidade, limites (sem banco; testadas em test/)
db.js            esquema SQLite e senhas do RH
email.js         avisos por e-mail (opcional)
scripts/         dados de demonstração
public/          home, portal do colaborador e área do RH (HTML/CSS/JS puro, visual da Trilha DHO)
```
