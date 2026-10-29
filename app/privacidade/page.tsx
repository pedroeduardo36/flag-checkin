import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/Brand";
import { senderAddress } from "@/lib/server/email";
import { CONSENT_VERSION } from "@/lib/server/guardian";
import { PRIVACY_OWNER, REQUEST_DAYS, RETENTION as R } from "@/lib/privacy";

export const metadata: Metadata = { title: "Privacidade · Check-in Flag O2" };

// Explicação para as famílias e os adolescentes. Linguagem simples; os detalhes técnicos ficam em docs/privacidade.
export default function PrivacidadePage() {
  const contato = process.env.PRIVACY_EMAIL || senderAddress();
  const rows: [string, string, string][] = [
    ["Nome e data de nascimento do adolescente", "Encontrar o cadastro no check-in", "Enquanto o cadastro existir"],
    ["Celular do adolescente (opcional)", "Falar com o adolescente, se preciso", "Enquanto o cadastro existir"],
    ["Nome, telefone e e-mail do responsável", "Confirmar o cadastro, avisar de cada check-in e atender pedidos", "Enquanto o cadastro existir"],
    ["Foto de registro e dados do rosto (biometria)", "Conferir que quem faz o check-in é o próprio adolescente", "Enquanto o cadastro existir, ou até a autorização ser retirada"],
    ["Foto criativa de cada check-in", "Mostrar aos líderes quem chegou", `${R.checkinPhotoDays} dias`],
    ["Dia e horário de cada presença", "Controle de presença e acompanhamento pelos líderes", "Enquanto o cadastro existir"],
    ["Distância até a igreja no check-in", "Conferir que o check-in foi feito no local", "Enquanto o cadastro existir"],
    ["Registro técnico das tentativas (com o endereço de internet embaralhado)", "Investigar abusos", `${R.auditDays} dias`],
    ["Visitante: nome, telefone e foto opcional", "Registrar a visita", `${R.visitorDays} dias`],
  ];

  return (
    <Shell>
      <h1>Como cuidamos dos dados</h1>
      <p className="lead">
        Explicação para pais, mães, responsáveis e adolescentes sobre o check-in da Juventude O2 · Ministério Flag.
      </p>

      <div className="privacy">
        <div className="info">
          <span aria-hidden>📌</span>
          <span>
            <strong>Resumo:</strong> usamos os dados só para registrar a presença nos cultos e avisar o responsável. O
            reconhecimento facial confere que quem faz o check-in é o próprio adolescente. Não vendemos, não publicamos e
            não usamos os dados para mais nada. O responsável pode pedir para ver, corrigir ou apagar tudo a qualquer momento.
          </span>
        </div>

        <h2>Quem cuida dos dados</h2>
        <p>
          O <b>Ministério Flag (Juventude O2)</b>. Pedidos e dúvidas: <b>{PRIVACY_OWNER}</b>
          {contato ? <>, pelo e-mail <a href={`mailto:${contato}`}>{contato}</a></> : null}.
        </p>

        <h2>Reconhecimento facial, explicado</h2>
        <ol>
          <li>
            No <b>primeiro check-in</b>, o adolescente tira uma foto só do rosto: a <b>foto de registro</b>.
          </li>
          <li>
            O sistema transforma essa foto em uma lista de 128 números que descreve o formato do rosto. Esses números são um
            <b> dado biométrico</b>, um tipo de dado pessoal sensível que a lei protege de forma especial.
          </li>
          <li>
            Nos check-ins seguintes, a foto criativa é comparada com esses números. Se ninguém na foto for o adolescente, o
            check-in não é feito. É assim que evitamos que alguém faça o check-in por outra pessoa.
          </li>
        </ol>
        <p>
          A comparação é feita no nosso servidor. Os números do rosto não são compartilhados com ninguém e não servem para
          identificar o adolescente em nenhum outro lugar. Eles ficam guardados enquanto o cadastro existir e são apagados
          junto com ele, ou antes, se o responsável retirar a autorização.
        </p>
        <p>
          <b>Sem a autorização para o reconhecimento facial</b>, o adolescente participa normalmente dos cultos e de tudo da
          O2. Ele só não registra a presença pelo celular.
        </p>

        <h2>Fotos</h2>
        <ul>
          <li><b>Foto de registro:</b> fica no cadastro, para a comparação. Só os líderes veem.</li>
          <li>
            <b>Foto criativa:</b> tirada no culto, pode ter amigos junto. Só os líderes logados veem, no app, e ela é apagada
            em <b>{R.checkinPhotoDays} dias</b>.
          </li>
          <li>
            O aviso de check-in para o responsável é <b>só texto</b>, com o horário e sem foto, porque as fotos podem ter outros
            adolescentes. Nenhuma foto é publicada em redes sociais por este sistema.
          </li>
        </ul>

        <h2>Localização</h2>
        <p>
          No momento do check-in, o celular informa onde está para confirmar que o adolescente está na igreja. Guardamos só
          a <b>distância até a igreja</b>, não o endereço nem as coordenadas.
        </p>

        <h2>O que guardamos e por quanto tempo</h2>
        <div className="table-wrap">
          <table className="privacy-table">
            <thead><tr><th>Dado</th><th>Para quê</th><th>Por quanto tempo</th></tr></thead>
            <tbody>{rows.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="hint">
          O cadastro é apagado se o responsável não confirmar em {R.confirmDays} dias e quando o adolescente fica{" "}
          {R.inactiveMonths} meses sem nenhuma presença. Apagar o cadastro apaga as fotos, os números do rosto e as presenças.
          As cópias de segurança do banco somem sozinhas em poucos dias.
        </p>

        <h2>Quem tem acesso</h2>
        <ul>
          <li>Os <b>líderes da O2</b>, cada um com conta própria, senha e código de um app autenticador.</li>
          <li>
            Os serviços que fazem o app funcionar, cada um só para a sua parte: <b>Supabase</b> (banco de dados e fotos,
            servidores em São Paulo), <b>Vercel</b> (o site) e <b>Google/Gmail</b> (envio dos e-mails).
          </li>
        </ul>

        <h2>Direitos do responsável e como pedir</h2>
        <p>
          A qualquer momento, o responsável pode pedir para <b>ver</b> os dados, <b>corrigir</b> algo, <b>apagar</b> o
          cadastro ou <b>retirar a autorização</b>, inteira ou só a do reconhecimento facial. Basta escrever para{" "}
          {contato ? <a href={`mailto:${contato}`}>{contato}</a> : "a liderança da O2"} ou falar com um líder. Antes,
          confirmamos que quem pede é mesmo o responsável. Respondemos em até <b>{REQUEST_DAYS} dias</b>.
        </p>

        <div className="info info--first">
          <span aria-hidden>🙋</span>
          <span>
            <strong>Para você, adolescente:</strong> sua foto de registro vira uma &quot;assinatura&quot; do seu rosto, que serve
            só para provar que foi você quem fez o check-in. Ninguém fora da liderança vê suas fotos. As fotos dos cultos
            somem em {R.checkinPhotoDays} dias. Se algo te incomodar, fale com um líder ou com seu responsável.
          </span>
        </div>

        <p className="hint">Versão do texto: {CONSENT_VERSION}.</p>
        <p><Link href="/cadastro">← Voltar ao cadastro</Link></p>
      </div>
    </Shell>
  );
}
