# Graylog MCP Server

Um servidor MCP (Model Context Protocol) básico em JavaScript para integração com Graylog, incluindo funcionalidades de saudação personalizada.

## Características

- Servidor MCP básico implementado em JavaScript
- Ferramenta de saudação que responde com mensagem personalizada
- Ambiente de desenvolvimento com Docker
- Uso da versão estável mais recente do Node.js (v20 LTS)
- Container com bash disponível para debug e desenvolvimento

## Pré-requisitos

- Docker
- Docker Compose

## Instalação e Execução

### Usando Docker (Recomendado)

1. Clone o repositório:
```bash
git clone <url-do-repositorio>
cd graylog-mcp
```

2. Execute com Docker Compose:
```bash
docker-compose up --build
```

Isso irá:
- Construir a imagem Docker com Node.js 20 Alpine
- Instalar as dependências
- Iniciar o servidor em modo de desenvolvimento com hot-reload

### Execução Local (prioritariamente dentro do container)

1. Instale as dependências:
```bash
npm install
```

2. Execute o servidor:
```bash
npm start
```

Ou para desenvolvimento com hot-reload:
```bash
npm run dev
```

## Ferramentas Disponíveis

### `greeting`

Responde com uma saudação personalizada.

**Parâmetros:**
- `username` (string, opcional): Nome do usuário para personalizar a saudação. Se não fornecido, usa "friend" como padrão.

**Exemplo de resposta:**
```
Hello, João! How're doing?
```

## Estrutura do Projeto

```
graylog-mcp/
├── src/
│   └── index.js          # Servidor MCP principal
├── docker-compose.yml    # Configuração Docker Compose
├── Dockerfile            # Configuração da imagem Docker
├── package.json          # Dependências e scripts
└── README.md            # Este arquivo
```

## Desenvolvimento

O projeto está configurado para desenvolvimento com Docker, incluindo:

- Volume mounting para hot-reload
- Node.js 20 LTS Alpine
- Porta 3000 exposta
- Ambiente de desenvolvimento configurado

### Scripts Disponíveis

- `npm start`: Inicia o servidor em modo produção
- `npm run dev`: Inicia o servidor em modo desenvolvimento com hot-reload
- `npm test`: Executa script de teste automatizado do servidor MCP

## Como Testar o Projeto

### 1. Teste Automatizado (Recomendado)

Execute o script de teste automatizado que valida todas as funcionalidades:

```bash
# Teste local
npm test

# Ou dentro do container Docker
docker run -it --rm -v $(pwd):/app graylog-mcp-server npm test
```

Este script testa automaticamente:
- Listagem de ferramentas disponíveis
- Ferramenta de saudação sem parâmetros
- Ferramenta de saudação com nome específico

### 2. Teste Direto do Servidor (Desenvolvimento)

Para testar o servidor MCP diretamente:

```bash
# Usando Docker (Recomendado)
docker-compose up --build

# Ou executar em modo interativo para debug
docker run -it --rm -v $(pwd):/app graylog-mcp-server bash
# Dentro do container:
npm start
```

### 3. Configuração no Cliente MCP (Cursor/Claude Desktop)

Para integrar com seu cliente MCP, adicione ao arquivo de configuração:

**Localizações comuns:**
- **Cursor**: `~/.cursor/mcp.json`
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Linux)**: `~/.config/claude-desktop/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "graylog-mcp": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/home/leo-ruellas/repositorios/mcp_servers/graylog-mcp"
    }
  }
}
```

### 4. Testando a Ferramenta de Saudação

Depois de configurado, você pode testar a ferramenta `greeting`:

1. **Reinicie o cliente MCP** (Cursor/Claude Desktop)
2. **Digite uma saudação** como:
   - "Hello!"
   - "Hi there!"
   - "Greetings!"
3. **Com nome específico**: "Hello, João!"
4. **Esperado**: A ferramenta deve responder "Hello, {username}! How're doing?"

### 5. Debug e Troubleshooting

#### Verificar se o servidor está funcionando:

```bash
# Teste local direto
cd /home/leo-ruellas/repositorios/mcp_servers/graylog-mcp
npm install
node src/index.js
```

#### Logs e debug:

```bash
# Ver logs do container
docker-compose logs -f

# Executar com debug
docker run -it --rm -v $(pwd):/app graylog-mcp-server bash -c "node --inspect src/index.js"
```

#### Verificar dependências:

```bash
# Dentro do container ou localmente
npm list @modelcontextprotocol/sdk
```

### 6. Teste Manual da API MCP

Para teste manual avançado, você pode usar ferramentas como `stdio` para comunicar diretamente:

```bash
# Exemplo de teste stdio (avançado)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node src/index.js
```

### 7. Verificação da Configuração

Se houver problemas, verifique:

1. **Caminho correto** no arquivo de configuração MCP
2. **Dependências instaladas** (`npm install`)
3. **Permissões de arquivo** (Node.js executável)
4. **Logs de erro** do cliente MCP

## Arquitetura

O servidor implementa o padrão MCP (Model Context Protocol) usando o SDK oficial:

- **Server**: Instância principal do servidor MCP
- **Transport**: Comunicação via stdio
- **Tools**: Ferramentas disponíveis (atualmente apenas `greeting`)
- **Error Handling**: Tratamento de erros e sinais do sistema

## Próximos Passos

Este é um boilerplate básico. Funcionalidades futuras podem incluir:

- Integração real com Graylog APIs
- Ferramentas de busca e análise de logs
- Autenticação e configuração
- Mais ferramentas de utilidade

## Roadmap

- [ ] Tool for fetching messages
- [ ] Tool for counting messages
- [ ] Tool for identifying relevante indexes based on context

## Licença

MIT