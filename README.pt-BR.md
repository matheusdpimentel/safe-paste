# SafePaste

[English](README.md) | **Português (Brasil)**

Sanitizador de textos, arquivos TXT/JSON/Markdown e PDFs para revisão de dados sensíveis antes de compartilhar com ferramentas de IA. Aplicação estática, sem backend.

## Usar — sem instalar nada

1. Baixe **somente** o arquivo `index.html` deste repositório.
2. Abra o arquivo no navegador (dois cliques).
3. Use a aba **Texto e código** para colar conteúdo **ou importar `.txt`, `.json` e `.md`**; depois revise, copie ou baixe o arquivo protegido. A aba **PDF** continua oferecendo prévia, tarjas e exportação.

**Texto e PDF funcionam offline a partir de um único `index.html`.** O arquivo contém PDF.js, worker, fontes padrão de PDF e decodificadores. Use um navegador atualizado. O fluxo PDF por `file://` foi verificado no Chrome. O aplicativo também pode ser hospedado no GitHub Pages e funciona sem instalar Python, Node.js, extensões ou servidor.

## Recursos

- Destaque dos trechos detectados no texto original.
- Substituição por valores fictícios no segundo campo.
- Botões de exemplo, limpar, copiar e **baixar o texto protegido**.
- **Importação local de arquivos** `.txt`, `.json` e `.md` (UTF-8, até 5 MB), com edição no próprio editor e download na extensão original.
- JSON de entrada e JSON sanitizado são validados; quando a substituição quebra o JSON, o download e a cópia são bloqueados até a revisão.
- Interface em **pt-BR e en-US**, com seletor **PT | EN** no cabeçalho. Na primeira visita, usa o idioma do navegador (inglês como alternativa); a escolha manual é salva localmente.
- Alternância entre tema claro e escuro. Somente as preferências de tema e idioma são salvas no navegador; conteúdo e escolhas dos detectores não são persistidos.
- Menu **O que detectar**, recolhido inicialmente, com 13 interruptores individuais no estilo iOS. Todas as categorias começam ligadas a cada abertura da página.
- Detecção por regras para credenciais, tokens e determinados dados pessoais ou de rede.
- **PDF (experimental):** seleção local, prévia por página, tarjas automáticas e manuais, confirmação obrigatória e download de um PDF novo, composto somente por imagens.

## Importar e baixar TXT, JSON ou Markdown

1. Na aba **Texto e código**, clique em **Importar arquivo** e selecione `.txt`, `.json` ou `.md` (máximo **5 MB**, codificação **UTF-8**).
2. O conteúdo aparece no editor original e é sanitizado automaticamente à direita, usando as mesmas detecções configuráveis do texto colado.
3. Revise os destaques. Se necessário, altere o conteúdo original ou ajuste os interruptores em **O que detectar**.
4. Clique em **Baixar protegido**. A aplicação usa um nome neutro, como `safepaste-protegido.json`, `safepaste-protegido.md` ou `safepaste-protegido.txt`, e aproveita apenas a extensão validada do nome original. Texto colado é baixado como `.txt`.
5. **Limpar tudo** apaga o conteúdo visível e desvincula o arquivo importado, sem modificar o original no computador.

O arquivo é lido usando as APIs locais do navegador; não é enviado para servidor. O navegador não instala software nem grava automaticamente o texto. O download é iniciado apenas por ação do usuário. **Importação não equivale a anonimização garantida**: revise as substituições.

- **JSON:** a aplicação confere se o arquivo de entrada é JSON válido e se a saída continua sintaticamente válida. A formatação original (espaços, linhas e ordem textual) é conservada sempre que a substituição não a altera. Casos em que alguma regra quebra a sintaxe bloqueiam a cópia e o download até correção.
- **Markdown:** títulos, listas, blocos de código e outras marcações permanecem como texto; substituições incidem sobre conteúdos detectados. O SafePaste não executa Markdown nem JSON importados.
- **Limites:** somente UTF-8; arquivos binários, extensões não suportadas e arquivos maiores que 5 MB são recusados. Não há processamento de diretórios nem conversão de DOCX/XLSX. PDF continua na aba dedicada.

Para ampliar os formatos e manter as verificações de segurança, consulte [docs/text-files.md](docs/text-files.md).

## Configuração rápida

Clique em **O que detectar**, abaixo dos dois campos, para abrir as categorias:

- **Credenciais e acessos:** segredos em variáveis, tokens conhecidos, Bearer, JWT, chaves privadas e credenciais em URLs.
- **Dados pessoais:** CPF, CNPJ, e-mail, telefones brasileiros e endereços/CEPs.
- **Infraestrutura e IDs:** IPv4 e UUID.

Cada categoria possui um interruptor independente. Os resultados e os destaques são atualizados imediatamente; **Ativar todas** restaura a proteção padrão. O painel começa fechado e todas as regras começam ativas ao abrir ou recarregar o HTML. As escolhas não são gravadas: assim, ninguém inicia outra sessão com proteções desativadas por engano.

Algumas regras se sobrepõem (por exemplo, uma URL com senha dentro de `DATABASE_URL` também pode ser identificada como atribuição sensível). Desligar apenas uma delas não garante que esse trecho deixe de ser mascarado. Se todas forem desligadas, a cópia é bloqueada para evitar compartilhar o original inadvertidamente.

### Cobertura de telefone e endereço

- **Telefones:** celular brasileiro de 9 dígitos, fixos, DDD, `+55` e `0800` em formatos reconhecidos. Um número isolado de 11 dígitos pode ser ambíguo com CPF; o SafePaste mascara o valor, mas a classificação pode não ser a desejada sem rótulo.
- **Endereços e CEPs:** campos rotulados (`Endereço: ...`, `"endereco": "..."`), logradouros comuns com número (`Rua`, `Av.`, `Travessa`, etc.), complemento/bairro/cidade na mesma linha e CEP com hífen ou identificado por `CEP:`.
- **Limitação:** endereço sem formato comum, apenas bairro/cidade, endereço dividido entre várias linhas, idiomas diferentes e texto contido em imagens podem não ser detectados. Ajuste as tarjas manuais no PDF e revise o texto protegido.
- O PDF no navegador usa o **mesmo detector JavaScript**, enquanto o protótipo Python tem regras equivalentes mantidas separadamente.

## Estender os padrões de sanitização (contribuidores)

**[Tutorial passo a passo para criar novos detectores](docs/adding-detectors.md)** — da expressão regular ao interruptor, testes, prioridades, geração do HTML e cuidados para evitar vazamentos parciais.

O SafePaste aceita contribuições, mas todas as novas regras precisam incluir testes com **valores fictícios** e respeitar a política de não transmitir conteúdo para servidores externos.

## PDF direto no navegador (experimental)

**[Tutorial e arquitetura do modo PDF](docs/pdf-browser.md)**

1. Abra a aba **PDF · experimental** no `index.html`.
2. Selecione um documento `.pdf` (até 25 MB e 30 páginas).
3. Confira as tarjas sugeridas para CPF, tokens e outros padrões reconhecidos. **O detector usa o texto extraível do PDF; não há OCR**.
4. Percorra **todas as páginas**: arraste o mouse (ou dedo) para **desenhar uma tarja retangular**; use o **× de qualquer tarja** para removê-la, inclusive as automáticas. Se remover uma sugestão indevidamente, use **Restaurar automáticas**.
5. Marque as duas confirmações: revisão completa e **conversão das páginas em imagens**.
6. Clique em **Gerar PDF com tarjas**. A aplicação solicita outra confirmação e baixa um **novo PDF**.

**O que muda:** a exportação confere a renderização contra a prévia revisada e substitui os pixels nas regiões tarjadas por preto opaco. O PDF novo contém imagens com compressão sem perdas. Preserva a ordem e as dimensões visíveis das páginas, com possíveis diferenças na aparência. Texto selecionável, pesquisa, links, formulários, assinaturas e objetos originais ficam de fora.

**Limitações:** a detecção pode deixar passar dados ou posicionar tarjas de forma imprecisa. Páginas escaneadas, imagens e nomes próprios exigem atenção na revisão e podem precisar de tarjas manuais. A exportação é bloqueada se o leitor apontar processamento incompleto ou se a página divergir da prévia. Use **Cancelar operação** ou **Fechar PDF** para interromper o processamento ou liberar o documento. Consulte o [relatório de segurança](docs/security-audit.md).

Também existe um protótipo alternativo por linha de comando, em Python, documentado em **[docs/pdf-redaction.md](docs/pdf-redaction.md)**.

## Estrutura de desenvolvimento

- `index.html`: aplicação **autossuficiente gerada**, pronta para abrir diretamente.
- `src/index.html`: template da interface, fonte editável do HTML.
- `src/i18n.js` e `src/locales/`: seleção de idioma e catálogos PT/EN incorporados no build.
- `src/sanitize.js`: regras de detecção e substituição (fonte editável).
  - Telefones: celulares, fixos e 0800 brasileiros em formatos reconhecidos.
  - Endereços: campos `Endereço:`, logradouros com número, complementos na mesma linha e CEPs.
  - Ambas as categorias são usadas na aba PDF do navegador quando houver texto extraível; sem OCR, marque manualmente o que não for reconhecido.
- `src/app.js`: lógica dos controles do texto, importação e download (fonte editável).
- `src/text-files.js`: validação de arquivos textuais, UTF-8, JSON e nomes de download (fonte editável).
- `src/pdf-mode.js`: carregamento, detecção, prévia e tarjas no PDF.
- `src/pdf-build.js`: gera um PDF novo a partir de pixels RGB comprimidos sem perdas.
- `src/styles.css`: estilos (fonte editável).
- `tests/`: testes unitários e de regressão.
- `docs/`: guias para contribuir, modo PDF no navegador e protótipo Python.
- `tools/`: PDF experimental, executado opcionalmente com Python.

**Atenção:** o `index.html` contém uma cópia embutida de `src/`. Ao modificar esses arquivos, gere novamente o HTML autossuficiente, inclusive os hashes de CSP. Modificar só `src/` não altera o arquivo distribuído.

Para executar os testes de texto (opcional, apenas para quem desenvolve):

```bash
node --test
```

## Fluxo de uso com IA e contribuições assistidas

**[Guia de utilização e desenvolvimento assistido por IA](docs/ai-workflow.md)**. O princípio é: detecção local por padrões, revisão humana antes do compartilhamento, mudanças pequenas e testes de regressão. Agentes de código podem seguir o arquivo [`AGENTS.md`](AGENTS.md).

## Segurança e limitações

- Texto e PDF são processados em memória no navegador. A política CSP bloqueia conexões de rede. O visualizador PDF não carrega uma camada interativa para scripts ou formulários.
- Somente o tema e a preferência manual de idioma podem ser salvos em `localStorage`. Em navegadores que bloqueiam armazenamento, a troca continua funcionando durante a sessão.
- A detecção é baseada em padrões e **não garante remoção completa** de informações sensíveis. Revise tudo antes de compartilhar com terceiros.
- Evite colocar segredos reais em issues, capturas de tela ou commits.

Licença MIT.


## Gerar o HTML de distribuição

O `index.html` incorpora o CSS, o JavaScript e os recursos de PDF a partir da cópia local versionada. O arquivo funciona sem servidor, inclusive por `file://`.
Para editar o projeto, altere os arquivos em `src/` e depois execute:

```bash
node build.mjs
node --test
```

O script atualiza o HTML e os hashes da Content Security Policy (CSP).
Distribua o `index.html` gerado. O build usa apenas Node.js e os recursos versionados. As licenças e versões das dependências estão no [relatório de segurança](docs/security-audit.md).

### Cobertura e decisões de detecção

- CPF com e sem pontuação (sequências de 11 dígitos são ocultadas por precaução, mesmo sem dígitos verificadores válidos; isso pode gerar falsos positivos).
- CNPJ formatado; CNPJ não formatado validado ou identificado por rótulo `CNPJ`.
- Variáveis como `apitoken`, `api_token`, `apiToken`, `API_KEY`, `PASSWORD` em atribuições simples ou JSON. O **valor** é substituído; o nome da variável não é segredo por si só.
- Tokens reconhecíveis, cabeçalhos Bearer, URLs com credenciais, chaves privadas e e-mails.

**Não é uma auditoria de segurança completa:** segredos livres sem padrão, informações pessoais contextuais e dados distribuídos em campos distintos podem passar despercebidos. O texto final sempre precisa de revisão humana. Alguns números comuns podem ser ocultados por precaução.

### Visibilidade do editor

O campo de entrada exibe o texto diretamente no `textarea`, com cores legíveis nos temas claro e escuro. A camada de marcação fornece apenas o **fundo** dos destaques, sem substituir a renderização das letras. Isso evita que o conteúdo digitado desapareça durante a edição. O teste `ui-visibility.test.js` verifica essa regra no CSS e no HTML gerado.

## PDF fictício para testar as detecções de telefone e endereço

O arquivo [`examples/telefone-endereco-original.pdf`](examples/telefone-endereco-original.pdf) contém números, endereços e CEPs **fictícios**, além de texto comum que deve permanecer visível. Abra a aba PDF, selecione esse arquivo, confira cada tarja, aceite a conversão em imagens e gere a saída. Este exemplo não testa OCR, PDFs digitalizados ou layouts complexos.

**Troca de PDFs:** use **Trocar arquivo** no painel. Falhas na leitura preservam a revisão anterior. A [suíte de integração](docs/security-audit.md#reproduce-the-evidence) verifica a troca com o leitor PDF.js real e a rede bloqueada.

## Idioma e contribuição

O idioma altera apenas a interface e o sufixo do nome de download (`-protegido` ou `-protected`). O texto importado, os valores fictícios e as regras brasileiras (CPF, CNPJ, telefone, endereço e CEP) são os mesmos nos dois idiomas. Trocar o idioma preserva conteúdo, configurações, tema, tarjas e confirmações do PDF.

Os guias técnicos são mantidos em inglês. Consulte [CONTRIBUTING.md](CONTRIBUTING.md), [internacionalização](docs/i18n.md) e [análise de refatoração e melhorias](docs/refactoring-review.md). Não há OCR, tradução automática de conteúdo nem promessa de anonimização completa.
