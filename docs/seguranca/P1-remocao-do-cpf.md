# P1: Remoção do CPF e dos CPFs já guardados

| | |
| --- | --- |
| **Severidade** | P1 (dado de identificação de menores coletado sem necessidade) |
| **Reportado por** | revisão de código do mentor ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 3) |
| **Corrigido em** | 29/10/2026 |
| **Afetava** | `POST /api/cadastro`, formulário de cadastro, tela de confirmação, coluna `members.cpf`, scripts e testes |

## O problema

O CPF só servia para recusar um cadastro repetido. O check-in usa **nome + data de nascimento**, e as presenças
apontam para o **id interno** do cadastro (`members.id`). Guardar o CPF de menores sem precisar dele contraria a
minimização de dados (LGPD art. 6º, III, e art. 14). Além disso, o aviso "Este CPF já está cadastrado" confirmava
para qualquer pessoa que um CPF estava na base.

## O que mudou

### O app não pede, não valida, não grava e não devolve CPF

- Formulário (`components/CadastroForm.tsx`): campo, máscara, validação e linha da tela de confirmação removidos.
- API (`app/api/cadastro`): o campo `cpf` não é lido. Um cliente antigo que ainda envie CPF tem o valor descartado.
- `lib/format.ts`: `isValidCpf` e `maskCpf` removidos, e os testes deles também.
- Scripts de simulação e o teste ponta a ponta não geram mais CPF.
- Documentação (README e `docs/SETUP.md`) atualizada.

### Banco em duas etapas controladas

1. **`20261029000000_cpf_opcional_duplicados.sql`**, compatível com a versão anterior do app. Tira o `not null` e
   a unicidade, **apaga todos os CPFs guardados** (`update ... set cpf = null`) e cria a marcação de possível
   duplicado e a função de mescla.
2. **`20261029120000_remover_coluna_cpf.sql`**: apaga a coluna. Vai **depois** que a versão nova estiver no ar,
   porque a versão anterior ainda grava CPF no cadastro.

Os ids internos, as presenças, os check-ins e as fotos não são tocados por nenhuma das duas etapas.

### Possíveis duplicados, revisados por um líder

O CPF dava um "não" automático. Agora o cadastro usa só dados que o formulário já pede (`lib/duplicates.ts`):

| Situação | O que acontece |
| --- | --- |
| Mesmo nascimento, nome igual (sem diferenciar acento, "de/da") **e** mesmo e-mail do responsável | É o mesmo responsável reenviando: nada é gravado, e a confirmação sai de novo para o e-mail dele. |
| Mesmo nascimento e nome compatível (o mesmo critério do check-in: nome do meio omitido, um erro de digitação) | O cadastro é gravado com `possible_duplicate_of` apontando para o mais antigo. |
| Nome diferente | Cadastro normal. |

Nos três casos a resposta é **idêntica**, então o formulário público não revela se alguém já está cadastrado (o
aviso de "CPF já cadastrado" revelava).

Na aba **Líderes → Possíveis cadastros duplicados**, o líder vê os dois lados com nome, nascimento, nome do
responsável, data do cadastro, número de presenças, se há foto e se o contato do responsável coincide. O e-mail e o
telefone em si não aparecem. Há duas decisões:

- **É a mesma pessoa: mesclar.** Feita pela função `mesclar_cadastro`, numa transação. As presenças do cadastro novo
  passam para o antigo. Num culto que os dois têm, vale a do antigo e a foto da outra é apagada. O antigo herda a
  foto de referência só se não tiver uma. O cadastro novo é apagado e o id do antigo continua o mesmo.
- **São pessoas diferentes.** A marcação sai.

As duas decisões vão para o registro de ações (`duplicado_descartado` e `cadastro_mesclado`, com quem fez, o alvo e
o horário). Enquanto os dois cadastros tiverem o mesmo nome, o check-in responde "mais de um cadastro parecido" e
pede o nome completo ou um líder. Assim, nenhum adolescente faz check-in no cadastro errado sem perceber.

## Cópias fora do banco

| Onde | Situação |
| --- | --- |
| Repositório | O único CPF que sobra é o exemplo público de documentação `529.982.247-25`, enviado de propósito pelo teste ponta a ponta para provar que o servidor descarta o campo. Nenhum CPF real foi commitado: os testes antigos geravam números aleatórios e apagavam o cadastro no fim. |
| Arquivos operacionais (`logs/`, exportações locais) | Verificado em 29/10/2026: `logs/confirmacao-cadastro.json` não tem CPF, e não há CSV ou planilha exportada com CPF nesta máquina. |
| View `presencas` (exportação CSV pelo painel) | Nunca incluiu CPF. |
| E-mails (confirmação de cadastro e aviso de check-in) | Nunca incluíram CPF. |
| Logs da Vercel | A rota tratava o CPF repetido antes de qualquer log de erro, então o valor não era escrito. Os logs de função expiram sozinhos no prazo do plano. |
| `audit_events` e `admin_audit` | Nunca gravaram CPF. |
| **Backups do Supabase** | Os backups diários gerenciados ainda contêm o CPF dos cadastros feitos até a etapa 1. Eles **não são editáveis** e expiram sozinhos ao fim da janela de retenção do plano: nenhum no Free, 7 dias no Pro, 14 no Team e até 30 no Enterprise, e o PITR, se estiver ligado, segue a janela configurada. **Data de expiração:** a data da etapa 1 mais a janela do plano. Até lá, não restaure um backup anterior à etapa 1. Se precisar restaurar, rode `update public.members set cpf = null` (ou a etapa 2) logo em seguida. Depois dessa data, não resta cópia. |

## Verificação

| Critério de aceite | Teste ponta a ponta |
| --- | --- |
| Cadastro novo funciona sem CPF | Cadastro com um CPF enviado por um "cliente antigo" retorna 200, e a coluna não existe ou está vazia |
| Ids e históricos intactos | A mescla mantém o id do original, junta as presenças sem repetir culto e mantém o descritor facial do original |
| O app não coleta nem devolve CPF | Não há campo no formulário, a API descarta o valor e a revisão de duplicados não expõe CPF, e-mail nem telefone |
| Duplicados sinalizados com dados menos invasivos | Reenvio do mesmo responsável não duplica e responde igual; nome escrito de outro jeito, com outro e-mail, entra marcado; o check-in fica ambíguo até a revisão; a lista exige líder (401); "pessoas diferentes" e "mesclar" funcionam e ficam na trilha |

Teste unitário novo, `tests/duplicates.test.ts`, cobre o reenvio, a marcação, o irmão com o mesmo e-mail, o nome
diferente e a escolha do cadastro mais parecido.

## Implantação

1. Aplicar a etapa 1 (`20261029000000_cpf_opcional_duplicados.sql`). A versão no ar continua funcionando, e os CPFs
   existentes são apagados aqui.
2. Publicar o código (merge do PR na `main`).
3. Aplicar a etapa 2 (`20261029120000_remover_coluna_cpf.sql`).
4. Anotar a data da etapa 1 e a janela de backup do plano. É nessa data que a última cópia do CPF expira.

**Etapa 1 aplicada em produção em 29/10/2026.** Antes: 112 cadastros (112 com CPF), 48 com foto de referência e 59
presenças. Depois: 112 cadastros (**0 com CPF**), 48 com foto e 59 presenças. O teste ponta a ponta (98 verificações)
passou contra o banco de produção, com o código desta branch.
