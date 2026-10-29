# Revisão jurídica: o que levar ao advogado

Este PR implementa a parte técnica. **Ele não substitui** uma revisão por advogado(a) brasileiro(a) com experiência em
LGPD, ECA e ECA Digital (Lei 15.211/2025). Leve este arquivo, o [inventário](inventario-de-dados.md), a página
`/privacidade` e o texto de consentimento (formulário e `/confirmar`).

## Perguntas

### Reconhecimento facial de menores

1. **Necessidade.** A biometria serve só para impedir que alguém faça o check-in por outro adolescente. A finalidade
   (registro de presença em culto) justifica dado sensível de menores? A cerca geográfica com foto conferida pelos
   líderes, sem biometria, seria suficiente (art. 6º, III, necessidade)?
2. **Base legal.** Propomos consentimento específico e destacado do responsável (art. 11, I, e art. 14, §1º),
   confirmado pelo dono do e-mail. Ela é adequada? A instituição religiosa tem alguma outra base aplicável?
3. **Consentimento livre.** Hoje, sem biometria o adolescente participa de tudo, mas não registra presença pelo celular.
   Isso torna o consentimento condicionado (art. 8º, §4º, e art. 14, §4º)? É preciso oferecer um registro de presença
   alternativo, por exemplo feito pelo líder?
4. **Relatório de impacto (RIPD).** O tratamento de biometria de adolescentes exige ou recomenda um relatório de
   impacto (art. 38)? Se sim, este repositório pode guardá-lo.
5. **Opinião do adolescente.** O ECA e o ECA Digital pedem considerar a opinião do adolescente. A explicação "para você,
   adolescente" em `/privacidade` e no passo da foto de registro é suficiente?

### Responsável e verificação

6. A confirmação pelo e-mail prova que a pessoa controla o e-mail, **não** que é o responsável legal. Para este
   contexto (comunidade presencial, líderes que conhecem as famílias), isso é suficiente, somado à confirmação
   presencial quando há dúvida? O art. 14, §5º, pede "todos os esforços razoáveis".
7. Os cadastros anteriores a esta versão aceitaram um texto que **não explicava a biometria**. O caminho adotado foi
   pedir novo consentimento até 30/11/2026, apagar quem não confirmar e manter o check-in nesse meio-tempo. A
   biometria desses cadastros deveria ser suspensa já, até a nova confirmação?

### Fotos

8. Fotos criativas podem ter outros adolescentes. Elas ficam só no app, visíveis aos líderes, por 30 dias, e não
   saem por e-mail. Isso basta, ou cada adolescente que aparece numa foto em grupo precisa ter autorização para
   imagem?
9. Os avisos antigos com foto continuam nas caixas de entrada dos responsáveis. Há alguma providência a tomar?

### Organização

10. Quem é o **controlador**: a igreja (pessoa jurídica) ou o ministério? Quem deve ser o **encarregado** (art. 41)?
    Agentes de pequeno porte (Resolução CD/ANPD nº 2/2022) podem dispensar o encarregado, mas precisam de um canal.
11. Transferência internacional: o envio de e-mails pelo Gmail (Google) precisa de alguma cláusula ou aviso
    específico (art. 33 e Resolução CD/ANPD nº 19/2024)?
12. Os prazos de retenção do [inventário](inventario-de-dados.md) são adequados? Algum dado precisa ser guardado por
    mais tempo por obrigação legal, por exemplo para provar o consentimento depois de o cadastro ser apagado?

## Depois da revisão

Ajustar o texto de `/privacidade`, do formulário e de `/confirmar` e subir `CONSENT_VERSION` (`lib/server/guardian.ts`).
Com a versão nova, os responsáveis precisam confirmar de novo, pelo script `npm run verificacao:enviar` adaptado à nova
versão. Registrar aqui a data e o nome de quem revisou.
