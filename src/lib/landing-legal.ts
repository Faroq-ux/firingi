/**
 * Phase 56: starting texts for the legal pages (EU GDPR privacy policy, cookies, terms), in English and Portuguese.
 * FIRINGI replaces them in the back office (any language); until then these show, with the company details filled in.
 * Other languages show the English text. Have them checked by FIRINGI's lawyer before going live.
 */
import type { LegalPage } from "./landing";

type Texts = Record<LegalPage, string>;

const EN: Texts = {
  privacy: `This policy explains how {company} ("FIRINGI", "we") uses personal data, under the EU General Data Protection Regulation (GDPR, Regulation (EU) 2016/679) and Portuguese data protection law (Law 58/2019).

1. Who is responsible
{company}{nif}{address}. Contact for data protection: {email}.

2. What data we use
- Account data of the people who use FIRINGI for their business: name, business email, phone, role, language, login records.
- Business data: company name, NIF / VAT number, addresses, orders, invoices, payments, deliveries, messages with FIRINGI and vendors.
- Website data: what you send us in the contact or vendor form, and newsletter sign-ups (email, language, the date you confirmed).
- Technical data: IP address (kept only in short-lived security logs or as a one-way code), browser type, error reports.

3. Why we use it, and the legal basis
- To run your account, orders, deliveries, invoices and payments: contract (Art. 6(1)(b) GDPR).
- To issue invoices, keep accounts and meet tax and food-safety rules: legal obligation (Art. 6(1)(c)).
- To answer your questions and follow up vendor applications: steps before a contract and legitimate interest (Art. 6(1)(b) and (f)).
- To send the newsletter: your consent (Art. 6(1)(a)), which you can withdraw at any time with the link in every email.
- To keep FIRINGI secure and prevent fraud: legitimate interest (Art. 6(1)(f)).

4. Who receives it
Vendors receive what they need to prepare and deliver your order. Service providers that work for us (hosting, email, payments, certified invoicing, delivery) receive data under a data processing agreement. Authorities receive data only when the law requires it. We do not sell personal data.

5. Where it is kept
In the European Union. If a provider is outside the EU/EEA, we use the safeguards of the GDPR (adequacy decision or standard contractual clauses).

6. How long
Account and order data while the account is active and then as long as tax and accounting law requires (in Portugal, normally 10 years for invoices). Website messages for up to 2 years. Newsletter data until you unsubscribe. Security logs for up to 12 months.

7. Your rights
You can ask to see, correct, delete, restrict or move your data, and object to its use, by writing to {email}. Signed-in users can also download or delete their data from their account settings. We answer within one month. You can complain to the Portuguese data protection authority, CNPD (www.cnpd.pt), or to the authority of your EU country.

8. Cookies
See the Cookies page. The website uses only cookies that are needed for it to work.

9. Changes
We publish changes on this page with a new date.`,
  cookies: `The FIRINGI website and app use only cookies that are strictly necessary for them to work. These do not need your consent under EU rules (ePrivacy Directive, Art. 5(3)).

- Language (NEXT_LOCALE): remembers the language you chose. Kept for 1 year.
- Look (theme): remembers light or dark mode, if you chose one. Kept for 1 year.
- Sign-in (session cookies): keep you signed in and protect your account. Deleted when you sign out or after they expire.

We do not use advertising or tracking cookies, and we do not share cookie data with third parties.

You can delete cookies in your browser settings at any time; the website then forgets your language and you need to sign in again.

Questions: {email}.`,
  terms: `These terms apply to the use of the FIRINGI marketplace, operated by {company}{nif}{address}.

1. For businesses only
FIRINGI sells to companies and sole traders with a valid NIF / VAT number. Prices are wholesale and shown before IVA.

2. Accounts
FIRINGI checks every account before it can order or sell. You keep your login details safe and are responsible for what your users do.

3. Orders and invoices
An order is a request to buy from the vendors in your cart. FIRINGI invoices you for every order, with your company name and NIF. Each vendor's minimum order, delivery days and costs are shown in your cart before you pay.

4. Payment
You pay FIRINGI by the methods shown at checkout. Approved accounts may pay on terms; overdue amounts may stop new orders.

5. Delivery, damage and returns
Check deliveries against the transport document. Report damaged or missing goods in the app within the time shown on the website; you receive a replacement or a credit note.

6. Vendors
Vendors set their own products, prices and delivery terms, and remain responsible for the goods they sell, including food safety and labelling.

7. Liability
FIRINGI is liable as set out by Portuguese law. Nothing in these terms limits rights that cannot be limited by law.

8. Law and disputes
Portuguese law applies. Complaints: {email}, or the Livro de Reclamações (www.livroreclamacoes.pt).`,
};

const PT: Texts = {
  privacy: `Esta política explica como a {company} ("FIRINGI", "nós") trata dados pessoais, nos termos do Regulamento Geral sobre a Proteção de Dados (RGPD, Regulamento (UE) 2016/679) e da Lei n.º 58/2019.

1. Responsável pelo tratamento
{company}{nif}{address}. Contacto para proteção de dados: {email}.

2. Que dados tratamos
- Dados de conta das pessoas que usam a FIRINGI para a sua empresa: nome, email profissional, telefone, função, idioma, registos de acesso.
- Dados da empresa: designação, NIF, moradas, encomendas, faturas, pagamentos, entregas, mensagens com a FIRINGI e os fornecedores.
- Dados do site: o que nos envia no formulário de contacto ou de fornecedor e as subscrições da newsletter (email, idioma, data de confirmação).
- Dados técnicos: endereço IP (apenas em registos de segurança de curta duração ou como código irreversível), tipo de navegador, relatórios de erro.

3. Finalidades e fundamento
- Gerir a sua conta, encomendas, entregas, faturas e pagamentos: execução de contrato (art. 6.º, n.º 1, al. b) RGPD).
- Emitir faturas, manter a contabilidade e cumprir regras fiscais e de segurança alimentar: obrigação legal (al. c)).
- Responder às suas questões e acompanhar candidaturas de fornecedores: diligências pré-contratuais e interesse legítimo (als. b) e f)).
- Enviar a newsletter: o seu consentimento (al. a)), que pode retirar a qualquer momento pela ligação em cada email.
- Manter a FIRINGI segura e prevenir fraude: interesse legítimo (al. f)).

4. Destinatários
Os fornecedores recebem o necessário para preparar e entregar a sua encomenda. Os prestadores que trabalham para nós (alojamento, email, pagamentos, faturação certificada, entregas) recebem dados ao abrigo de um acordo de subcontratação. As autoridades só recebem dados quando a lei o exige. Não vendemos dados pessoais.

5. Onde são guardados
Na União Europeia. Se um prestador estiver fora da UE/EEE, aplicamos as garantias do RGPD (decisão de adequação ou cláusulas contratuais-tipo).

6. Durante quanto tempo
Dados de conta e encomendas enquanto a conta estiver ativa e depois pelo prazo exigido pela lei fiscal e contabilística (normalmente 10 anos para faturas). Mensagens do site até 2 anos. Dados da newsletter até cancelar a subscrição. Registos de segurança até 12 meses.

7. Os seus direitos
Pode pedir acesso, retificação, apagamento, limitação ou portabilidade dos seus dados e opor-se ao seu tratamento, escrevendo para {email}. Os utilizadores com sessão iniciada também podem descarregar ou apagar os seus dados nas definições da conta. Respondemos no prazo de um mês. Pode apresentar reclamação à CNPD (www.cnpd.pt) ou à autoridade do seu país da UE.

8. Cookies
Consulte a página Cookies. O site usa apenas cookies necessários ao seu funcionamento.

9. Alterações
Publicamos as alterações nesta página com nova data.`,
  cookies: `O site e a aplicação FIRINGI usam apenas cookies estritamente necessários ao seu funcionamento. Estes não precisam do seu consentimento segundo as regras da UE (Diretiva ePrivacy, art. 5.º, n.º 3).

- Idioma (NEXT_LOCALE): guarda o idioma que escolheu. Dura 1 ano.
- Aspeto (theme): guarda o modo claro ou escuro, se escolheu um. Dura 1 ano.
- Sessão: mantém a sessão iniciada e protege a sua conta. São apagados quando termina a sessão ou expiram.

Não usamos cookies de publicidade nem de seguimento e não partilhamos dados de cookies com terceiros.

Pode apagar os cookies nas definições do navegador a qualquer momento; o site esquece o idioma e terá de iniciar sessão de novo.

Questões: {email}.`,
  terms: `Estes termos aplicam-se à utilização do marketplace FIRINGI, gerido pela {company}{nif}{address}.

1. Apenas para empresas
A FIRINGI vende a empresas e empresários em nome individual com NIF válido. Os preços são de grosso e apresentados sem IVA.

2. Contas
A FIRINGI verifica cada conta antes de poder comprar ou vender. É responsável por guardar os dados de acesso e pelo que os seus utilizadores fazem.

3. Encomendas e faturas
Uma encomenda é um pedido de compra aos fornecedores do seu carrinho. A FIRINGI fatura-lhe cada encomenda, com a designação e o NIF da sua empresa. O mínimo, os dias e os custos de entrega de cada fornecedor aparecem no carrinho antes de pagar.

4. Pagamento
Paga à FIRINGI pelos meios indicados no checkout. Contas aprovadas podem pagar a prazo; valores em atraso podem impedir novas encomendas.

5. Entregas, danos e devoluções
Confira as entregas com a guia de transporte. Reporte mercadoria danificada ou em falta na app no prazo indicado no site; recebe uma substituição ou uma nota de crédito.

6. Fornecedores
Os fornecedores definem os seus produtos, preços e condições de entrega e continuam responsáveis pela mercadoria que vendem, incluindo segurança alimentar e rotulagem.

7. Responsabilidade
A FIRINGI responde nos termos da lei portuguesa. Nada nestes termos limita direitos que a lei não permite limitar.

8. Lei e litígios
Aplica-se a lei portuguesa. Reclamações: {email} ou Livro de Reclamações (www.livroreclamacoes.pt).`,
};

/** The starting text for a legal page in this language (Portuguese for pt-*, else English), with the company details filled in. */
export function defaultLegal(page: LegalPage, locale: string, co: { legalName: string; nif: string; address: string; email: string }) {
  const pt = locale.toLowerCase().startsWith("pt"), base = pt ? PT : EN;
  return base[page]
    .replace(/\{company\}/g, co.legalName || "FIRINGI")
    .replace(/\{nif\}/g, co.nif ? `, NIF ${co.nif}` : "")
    .replace(/\{address\}/g, co.address ? `, ${co.address}` : "")
    .replace(/\{email\}/g, co.email || (pt ? "o formulário de contacto do site" : "the contact form on the website"));
}
